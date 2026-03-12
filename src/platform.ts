import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SmartThingsClient } from './smartthings';
import { WindFreeRoomACAccessory } from './accessory';

export class WindFreeRoomACPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Cached accessories restored from disk by Homebridge on startup
  public readonly cachedAccessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('WindFreeRoomAC platform initialized');

    // Wait for Homebridge to finish restoring cached accessories before registering
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices().catch(err =>
        this.log.error('Startup failed:', err instanceof Error ? err.message : String(err)),
      );
    });
  }

  // Called by Homebridge for each restored cached accessory
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
    const { clientId, clientSecret, refreshToken, pollInterval } = this.config;
    let { deviceId } = this.config as { deviceId?: string };

    if (!clientId || !clientSecret || !refreshToken) {
      this.log.error('Missing required config: clientId, clientSecret, refreshToken');
      return;
    }

    const client = new SmartThingsClient(
      { clientId, clientSecret, refreshToken, deviceId },
      this.log,
      this.api.user.storagePath(),
    );

    if (!deviceId) {
      deviceId = await client.discoverDeviceId();
    }

    // Each sub-accessory has its own UUID derived from the device ID + role
    const accessories = [
      { suffix: 'thermostat', displayName: 'Room AC' },
      { suffix: 'windfree', displayName: 'WindFree' },
      { suffix: 'dry', displayName: 'Dry Mode' },
      { suffix: 'fan', displayName: 'Fan Mode' },
    ];

    const platformAccessories: PlatformAccessory[] = [];

    // Unregister any cached accessories that are no longer in the known set
    const knownUuids = new Set(accessories.map(({ suffix }) => this.api.hap.uuid.generate(`${deviceId}-${suffix}`)));
    const stale = this.cachedAccessories.filter(a => !knownUuids.has(a.UUID));
    if (stale.length > 0) {
      this.log.info('Removing stale accessories:', stale.map(a => a.displayName).join(', '));
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    for (const { suffix, displayName } of accessories) {
      const uuid = this.api.hap.uuid.generate(`${deviceId}-${suffix}`);
      const existing = this.cachedAccessories.find(a => a.UUID === uuid);

      if (existing) {
        this.log.info('Restoring existing accessory:', displayName);
        platformAccessories.push(existing);
      } else {
        this.log.info('Registering new accessory:', displayName);
        const accessory = new this.api.platformAccessory(displayName, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        platformAccessories.push(accessory);
      }
    }

    // Hand all accessories to the single controller class
    new WindFreeRoomACAccessory(
      this,
      client,
      platformAccessories,
      pollInterval ?? 30,
    );
  }
}
