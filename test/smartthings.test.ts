import axios from 'axios';
import { SmartThingsClient } from '../src/smartthings';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const FAKE_CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token',
  deviceId: 'test-device-id',
};

describe('SmartThingsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAccessToken', () => {
    it('exchanges refresh token for access token', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86399,
        },
      });

      const client = new SmartThingsClient(FAKE_CONFIG, jest.fn() as any);
      const token = await client.getAccessToken();

      expect(token).toBe('new-access-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.stringContaining('grant_type=refresh_token'),
        expect.objectContaining({
          auth: { username: 'test-client-id', password: 'test-client-secret' },
        }),
      );
    });

    it('reuses cached token when not expired', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: 'cached-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86399,
        },
      });

      const client = new SmartThingsClient(FAKE_CONFIG, jest.fn() as any);
      await client.getAccessToken();
      await client.getAccessToken();

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('shares a single refresh between concurrent callers', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          access_token: 'shared-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86399,
        },
      });

      const client = new SmartThingsClient(FAKE_CONFIG, jest.fn() as any);
      const tokens = await Promise.all([client.getAccessToken(), client.getAccessToken()]);

      expect(tokens).toEqual(['shared-token', 'shared-token']);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDeviceStatus', () => {
    it('returns parsed device status', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { access_token: 'tok', refresh_token: 'rt', expires_in: 86399 },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: {
          components: {
            main: {
              switch: { switch: { value: 'on' } },
              airConditionerMode: { airConditionerMode: { value: 'cool' } },
              temperatureMeasurement: { temperature: { value: 72, unit: 'F' } },
              thermostatCoolingSetpoint: { coolingSetpoint: { value: 75, unit: 'F' } },
              'custom.airConditionerOptionalMode': { acOptionalMode: { value: 'windFree' } },
              'samsungce.airConditionerLighting': { lighting: { value: 'on' } },
            },
          },
        },
      });

      const client = new SmartThingsClient(FAKE_CONFIG, jest.fn() as any);
      const status = await client.getDeviceStatus();

      expect(status).toEqual({
        switch: 'on',
        airConditionerMode: 'cool',
        temperature: 72,
        coolingSetpoint: 75,
        acOptionalMode: 'windFree',
        lighting: 'on',
      });
    });
  });

  describe('temperature conversion', () => {
    it('fToC converts Fahrenheit to Celsius', () => {
      const { fToC } = require('../src/smartthings');
      expect(fToC(32)).toBeCloseTo(0);
      expect(fToC(212)).toBeCloseTo(100);
      expect(fToC(75)).toBeCloseTo(23.89, 1);
    });

    it('cToF converts Celsius to Fahrenheit', () => {
      const { cToF } = require('../src/smartthings');
      expect(cToF(0)).toBeCloseTo(32);
      expect(cToF(100)).toBeCloseTo(212);
      expect(cToF(24)).toBeCloseTo(75.2, 1);
    });
  });
});
