import { PlatformAccessory, Service } from 'homebridge';
import { WindFreeRoomACPlatform } from './platform';
import { SmartThingsClient, DeviceStatus, fToC, cToF } from './smartthings';

// Index positions in the platformAccessories array (matches platform.ts order)
const IDX_THERMOSTAT = 0;
const IDX_WINDFREE   = 1;
const IDX_DRY        = 2;
const IDX_FAN        = 3;

export class WindFreeRoomACAccessory {
  private thermostatService: Service;
  private windFreeService: Service;
  private dryService: Service;
  private fanService: Service;

  private cachedStatus: DeviceStatus | null = null;

  // Temperature range in Celsius (API reports 61-86F)
  private readonly MIN_TEMP_C = fToC(61);
  private readonly MAX_TEMP_C = fToC(86);

  constructor(
    private readonly platform: WindFreeRoomACPlatform,
    private readonly client: SmartThingsClient,
    accessories: PlatformAccessory[],
    pollIntervalSeconds: number,
  ) {
    const { Service, Characteristic } = this.platform;

    // ─── Thermostat
    const thermostatAcc = accessories[IDX_THERMOSTAT];
    thermostatAcc.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'WindFree Room AC')
      .setCharacteristic(Characteristic.SerialNumber, 'DA-AC-RAC-01001');

    this.thermostatService = thermostatAcc.getService(Service.Thermostat)
      ?? thermostatAcc.addService(Service.Thermostat);

    this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.getCurrentHeatingCoolingState());

    this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .onGet(() => this.getTargetHeatingCoolingState())
      .onSet(async (value) => this.setTargetHeatingCoolingState(value as number));

    this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.getCurrentTemperature());

    this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: this.MIN_TEMP_C, maxValue: this.MAX_TEMP_C, minStep: 0.5 })
      .onGet(() => this.getTargetTemperature())
      .onSet(async (value) => this.setTargetTemperature(value as number));

    this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .setValue(Characteristic.TemperatureDisplayUnits.FAHRENHEIT);

    // ─── WindFree Switch
    const windFreeAcc = accessories[IDX_WINDFREE];
    windFreeAcc.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'WindFree AC - WindFree Mode');

    this.windFreeService = windFreeAcc.getService(Service.Switch)
      ?? windFreeAcc.addService(Service.Switch);

    this.windFreeService.getCharacteristic(Characteristic.On)
      .onGet(() => this.getWindFree())
      .onSet(async (value) => this.setWindFree(value as boolean));

    // ─── Dry Mode Switch
    const dryAcc = accessories[IDX_DRY];
    dryAcc.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'WindFree AC - Dry Mode');

    this.dryService = dryAcc.getService(Service.Switch)
      ?? dryAcc.addService(Service.Switch);

    this.dryService.getCharacteristic(Characteristic.On)
      .onGet(() => this.getDryMode())
      .onSet(async (value) => this.setDryMode(value as boolean));

    // ─── Fan Mode Switch
    const fanAcc = accessories[IDX_FAN];
    fanAcc.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'WindFree AC - Fan Mode');

    this.fanService = fanAcc.getService(Service.Switch)
      ?? fanAcc.addService(Service.Switch);

    this.fanService.getCharacteristic(Characteristic.On)
      .onGet(() => this.getFanMode())
      .onSet(async (value) => this.setFanMode(value as boolean));

    // ─── Start polling
    this.poll();
    setInterval(() => this.poll(), pollIntervalSeconds * 1000).unref();
  }

  // ─── Polling

  private async poll(): Promise<void> {
    try {
      this.cachedStatus = await this.client.getDeviceStatus();
      this.pushUpdates();
    } catch (err) {
      this.platform.log.error('Failed to poll device status:', err instanceof Error ? err.message : String(err));
    }
  }

  private pushUpdates(): void {
    if (!this.cachedStatus) {
      return;
    }
    const { Characteristic } = this.platform;

    this.thermostatService.updateCharacteristic(
      Characteristic.CurrentHeatingCoolingState,
      this.getCurrentHeatingCoolingState(),
    );
    this.thermostatService.updateCharacteristic(
      Characteristic.TargetHeatingCoolingState,
      this.getTargetHeatingCoolingState(),
    );
    this.thermostatService.updateCharacteristic(
      Characteristic.CurrentTemperature,
      this.getCurrentTemperature(),
    );
    this.thermostatService.updateCharacteristic(
      Characteristic.TargetTemperature,
      this.getTargetTemperature(),
    );
    this.windFreeService.updateCharacteristic(Characteristic.On, this.getWindFree());
    this.dryService.updateCharacteristic(Characteristic.On, this.getDryMode());
    this.fanService.updateCharacteristic(Characteristic.On, this.getFanMode());
  }

  // ─── Getters (read from cache)

  private getCurrentHeatingCoolingState(): number {
    const { Characteristic } = this.platform;
    if (!this.cachedStatus || this.cachedStatus.switch === 'off') {
      return Characteristic.CurrentHeatingCoolingState.OFF;
    }
    switch (this.cachedStatus.airConditionerMode) {
      case 'heat': return Characteristic.CurrentHeatingCoolingState.HEAT;
      case 'cool':
      case 'dry':
      case 'wind': return Characteristic.CurrentHeatingCoolingState.COOL;
      case 'auto':
      default:     return Characteristic.CurrentHeatingCoolingState.COOL; // best fit for auto
    }
  }

  private getTargetHeatingCoolingState(): number {
    const { Characteristic } = this.platform;
    if (!this.cachedStatus || this.cachedStatus.switch === 'off') {
      return Characteristic.TargetHeatingCoolingState.OFF;
    }
    switch (this.cachedStatus.airConditionerMode) {
      case 'heat': return Characteristic.TargetHeatingCoolingState.HEAT;
      case 'cool': return Characteristic.TargetHeatingCoolingState.COOL;
      case 'auto': return Characteristic.TargetHeatingCoolingState.AUTO;
      case 'dry':
      case 'wind': return Characteristic.TargetHeatingCoolingState.COOL;
      default:     return Characteristic.TargetHeatingCoolingState.AUTO;
    }
  }

  private getCurrentTemperature(): number {
    return fToC(this.cachedStatus?.temperature ?? 72);
  }

  private getTargetTemperature(): number {
    const raw = fToC(this.cachedStatus?.coolingSetpoint ?? 75);
    return Math.min(Math.max(raw, this.MIN_TEMP_C), this.MAX_TEMP_C);
  }

  private getWindFree(): boolean {
    return this.cachedStatus?.acOptionalMode === 'windFree';
  }

  private getDryMode(): boolean {
    return this.cachedStatus?.switch === 'on' && this.cachedStatus?.airConditionerMode === 'dry';
  }

  private getFanMode(): boolean {
    return this.cachedStatus?.switch === 'on' && this.cachedStatus?.airConditionerMode === 'wind';
  }

  // ─── Setters (send command then refresh cache)

  private async setTargetHeatingCoolingState(value: number): Promise<void> {
    const { Characteristic } = this.platform;
    this.platform.log.info('Setting thermostat mode to', value);
    try {
      if (value === Characteristic.TargetHeatingCoolingState.OFF) {
        await this.client.setPower(false);
      } else {
        await this.client.setPower(true);
        const mode = {
          [Characteristic.TargetHeatingCoolingState.HEAT]: 'heat',
          [Characteristic.TargetHeatingCoolingState.COOL]: 'cool',
          [Characteristic.TargetHeatingCoolingState.AUTO]: 'auto',
        }[value] ?? 'auto';
        await this.client.setAirConditionerMode(mode);
      }
      await this.poll();
    } catch (err) {
      this.platform.log.error('Failed to set thermostat mode:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async setTargetTemperature(valueC: number): Promise<void> {
    const tempF = Math.round(cToF(valueC));
    this.platform.log.info('Setting target temperature to', tempF, 'F');
    try {
      await this.client.setCoolingSetpoint(tempF);
      await this.poll();
    } catch (err) {
      this.platform.log.error('Failed to set target temperature:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async setWindFree(on: boolean): Promise<void> {
    this.platform.log.info('Setting WindFree to', on);
    try {
      await this.client.setOptionalMode(on ? 'windFree' : 'off');
      await this.poll();
    } catch (err) {
      this.platform.log.error('Failed to set WindFree mode:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async setExclusiveMode(on: boolean, mode: string, displayName: string): Promise<void> {
    this.platform.log.info(`Setting ${displayName} to`, on);
    try {
      if (on) {
        await this.client.setPower(true);
        await this.client.setAirConditionerMode(mode);
      } else if (this.cachedStatus?.airConditionerMode === mode) {
        // Only leave this mode if it's the active one; otherwise turning the switch off is a no-op
        await this.client.setAirConditionerMode('auto');
      }
      await this.poll();
    } catch (err) {
      this.platform.log.error(`Failed to set ${displayName}:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async setDryMode(on: boolean): Promise<void> {
    return this.setExclusiveMode(on, 'dry', 'Dry mode');
  }

  private async setFanMode(on: boolean): Promise<void> {
    return this.setExclusiveMode(on, 'wind', 'Fan mode');
  }
}
