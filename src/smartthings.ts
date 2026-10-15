import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Logger } from 'homebridge';
import { PLUGIN_NAME, ST_TOKEN_URL, ST_API_BASE, TOKEN_REFRESH_BUFFER_MS } from './settings';

const TOKEN_FILE_BASE_NAME = PLUGIN_NAME.replace(/^@[^/]+\//, '');
const REQUEST_TIMEOUT_MS = 10_000;

export interface SmartThingsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  deviceId?: string;
}

export interface DeviceStatus {
  switch: 'on' | 'off';
  airConditionerMode: 'auto' | 'cool' | 'heat' | 'dry' | 'wind';
  temperature: number;       // Fahrenheit
  coolingSetpoint: number;   // Fahrenheit
  acOptionalMode: string;
  lighting: 'on' | 'off';
}

export function fToC(f: number): number {
  return (f - 32) * 5 / 9;
}

export function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

export class SmartThingsClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private currentRefreshToken: string;
  private resolvedDeviceId: string | undefined;
  // In-flight refresh, shared so concurrent callers don't reuse a rotated refresh token
  private refreshInFlight: Promise<void> | null = null;

  private get deviceId(): string {
    const id = this.resolvedDeviceId ?? this.config.deviceId;
    if (!id) {
      throw new Error('Device ID not set — call discoverDeviceId() first or provide deviceId in config');
    }
    return id;
  }

  constructor(
    private readonly config: SmartThingsConfig,
    private readonly log: Logger,
    private readonly storageDir?: string,
  ) {
    this.currentRefreshToken = config.refreshToken;
    if (storageDir) {
      this.loadPersistedToken();
    }
  }

  private get tokenFilePath(): string {
    return path.join(this.storageDir!, `${TOKEN_FILE_BASE_NAME}-token.json`);
  }

  private loadPersistedToken(): void {
    try {
      const raw = fs.readFileSync(this.tokenFilePath, 'utf8');
      const data = JSON.parse(raw) as { refreshToken?: string };
      if (data.refreshToken) {
        this.currentRefreshToken = data.refreshToken;
        (this.log as Partial<Logger>).debug?.('Loaded persisted refresh token from', this.tokenFilePath);
      }
    } catch {
      // File doesn't exist yet — use the token from config
    }
  }

  private async persistToken(): Promise<void> {
    if (!this.storageDir) {
      return;
    }
    try {
      await fs.promises.writeFile(
        this.tokenFilePath,
        JSON.stringify({ refreshToken: this.currentRefreshToken }),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch (err) {
      (this.log as Partial<Logger>).warn?.('Failed to persist refresh token:', err);
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshToken().finally(() => {
        this.refreshInFlight = null;
      });
    }
    await this.refreshInFlight;
    return this.accessToken!;
  }

  // Converts an AxiosError into a concise Error, discarding the full request/response objects.
  private apiError(err: unknown, context: string): Error {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data as Record<string, unknown> | undefined;
      const apiMsg = data?.error_description ?? data?.error ?? err.message;
      const hint = data?.error === 'invalid_grant'
        ? ' — update refreshToken in config.json or wait for the persisted token to be refreshed'
        : '';
      return new Error(`${context}: HTTP ${status ?? 'unknown'} — ${apiMsg}${hint}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private async refreshToken(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.currentRefreshToken,
    });

    try {
      const response = await axios.post(ST_TOKEN_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: this.config.clientId, password: this.config.clientSecret },
        timeout: REQUEST_TIMEOUT_MS,
      });

      this.accessToken = response.data.access_token;
      this.currentRefreshToken = response.data.refresh_token ?? this.currentRefreshToken;
      this.tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
      (this.log as Partial<Logger>).debug?.('SmartThings token refreshed, expires in', response.data.expires_in, 's');
      await this.persistToken();
    } catch (err) {
      throw this.apiError(err, 'Token refresh failed');
    }
  }

  async discoverDeviceId(): Promise<string> {
    const token = await this.getAccessToken();
    try {
      const response = await axios.get(`${ST_API_BASE}/devices`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { capability: 'airConditionerMode' },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const items = response.data.items as Array<{ deviceId: string; label?: string; name?: string }>;
      if (items.length === 0) {
        throw new Error('No air conditioner devices found in your SmartThings account');
      }
      if (items.length > 1) {
        const list = items.map(d => `  ${d.deviceId}  (${d.label ?? d.name ?? 'unnamed'})`).join('\n');
        (this.log as Partial<Logger>).warn?.(`Multiple AC devices found — using first. Add deviceId to config to pick a specific one:\n${list}`);
      }
      this.resolvedDeviceId = items[0].deviceId;
      (this.log as Partial<Logger>).info?.(`Discovered device: ${items[0].label ?? items[0].name ?? this.resolvedDeviceId} (${this.resolvedDeviceId})`);
      return this.resolvedDeviceId;
    } catch (err) {
      throw this.apiError(err, 'Device discovery failed');
    }
  }

  async getDeviceStatus(): Promise<DeviceStatus> {
    const token = await this.getAccessToken();
    const url = `${ST_API_BASE}/devices/${this.deviceId}/status`;
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const main = response.data.components.main;
      return {
        switch: main.switch.switch.value,
        airConditionerMode: main.airConditionerMode.airConditionerMode.value,
        temperature: main.temperatureMeasurement.temperature.value,
        coolingSetpoint: main.thermostatCoolingSetpoint.coolingSetpoint.value,
        acOptionalMode: main['custom.airConditionerOptionalMode'].acOptionalMode.value,
        lighting: main['samsungce.airConditionerLighting'].lighting.value,
      };
    } catch (err) {
      throw this.apiError(err, 'Get device status failed');
    }
  }

  async sendCommand(capability: string, command: string, args: unknown[] = []): Promise<void> {
    const token = await this.getAccessToken();
    const url = `${ST_API_BASE}/devices/${this.deviceId}/commands`;
    try {
      await axios.post(url, {
        commands: [{
          component: 'main',
          capability,
          command,
          arguments: args,
        }],
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      throw this.apiError(err, `Command ${capability}/${command} failed`);
    }
  }

  async setPower(on: boolean): Promise<void> {
    await this.sendCommand('switch', on ? 'on' : 'off');
  }

  async setAirConditionerMode(mode: string): Promise<void> {
    await this.sendCommand('airConditionerMode', 'setAirConditionerMode', [mode]);
  }

  async setCoolingSetpoint(tempF: number): Promise<void> {
    await this.sendCommand('thermostatCoolingSetpoint', 'setCoolingSetpoint', [tempF]);
  }

  async setOptionalMode(mode: string): Promise<void> {
    await this.sendCommand('custom.airConditionerOptionalMode', 'setAcOptionalMode', [mode]);
  }

  async setLighting(on: boolean): Promise<void> {
    await this.sendCommand('samsungce.airConditionerLighting', 'setLighting', [on ? 'on' : 'off']);
  }
}
