# Homebridge Samsung WindFree Room AC

I recently got a Samsung WindFree Room Air Conditioner, but couldn't find a [Homebridge](https://homebridge.io) plugin that worked great for it. So here's a new one that uses the [SmartThings API](https://developer.smartthings.com/) to expose a thermostat and three switches in Apple HomeKit.

## HomeKit Accessories

| Accessory | Type | Description |
|-----------|------|-------------|
| Room AC | Thermostat | Power on/off, mode (Cool/Heat/Auto), and target temperature |
| WindFree | Switch | Enables WindFree (no-direct-airflow) mode |
| Dry Mode | Switch | Puts the AC into dehumidify mode |
| Fan Mode | Switch | Puts the AC into fan-only mode |

Temperature is displayed in Fahrenheit (the unit's native scale) but HomeKit internally uses Celsius — the plugin converts automatically.

## Prerequisites

- [Homebridge](https://homebridge.io) v1.6 or later
- Node.js 18 or later
- A Samsung SmartThings account with the AC registered
- A SmartThings OAuth client (Client ID + Client Secret) and a valid Refresh Token

## SmartThings OAuth Setup

### Step 1: Create an OAuth client

1. Log in to the [SmartThings Developer Workspace](https://smartthings.developer.samsung.com/workspace).
2. Create a new project → select **Automation for the SmartThings App**.
3. Under **Credentials**, create an OAuth client.
   - Set the redirect URI to `https://httpbin.org/get` (or any URL you control — it's just used to capture the auth code).
   - Under **Scopes**, add `r:devices:*` and `x:devices:*`.
4. Note the **Client ID** and **Client Secret**.

### Step 2: Get an authorization code

Open this URL in your browser, replacing the placeholders:

```
https://api.smartthings.com/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=https%3A%2F%2Fhttpbin.org%2Fget&scope=x%3Adevices%3A*+w%3Adevices%3A*+r%3Adevices%3A*
```

Log in with your Samsung account and approve access. You'll be redirected to your redirect URI with a `code` query parameter, e.g.:

```
https://httpbin.org/get?code=abc123...
```

Copy that `code` value — it expires in a few minutes.

### Step 3: Exchange the code for a refresh token

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=https://httpbin.org/get" \
  https://auth-global.api.smartthings.com/oauth/token
```

The response contains `refresh_token` — copy it into your Homebridge config. You only need to do this once; the plugin persists the rotating token automatically thereafter (see [Token Rotation](#token-rotation)).

The plugin will auto-discover your AC device at startup. If you have multiple AC units and need to target a specific one, find its device ID with:

```bash
curl -H "Authorization: Bearer ACCESS_TOKEN" \
  "https://api.smartthings.com/v1/devices?capability=airConditionerMode"
```

Use the `access_token` from the Step 3 response. Copy the `deviceId` of the unit you want and set it in the plugin config.

## Installation

```bash
npm install -g @heschong/homebridge-windfree-roomac
```

Or install via the Homebridge UI (Config UI X) by searching for `@heschong/homebridge-windfree-roomac`.

## Configuration

Add the following platform entry to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "WindFreeRoomAC",
      "name": "Samsung WindFree Room AC",
      "clientId": "your-smartthings-client-id",
      "clientSecret": "your-smartthings-client-secret",
      "refreshToken": "your-smartthings-refresh-token",
      "pollInterval": 30
    }
  ]
}
```

### Config Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `platform` | Yes | — | Must be `WindFreeRoomAC` |
| `name` | No | `Samsung WindFree Room AC` | Display name |
| `clientId` | Yes | — | SmartThings OAuth client ID |
| `clientSecret` | Yes | — | SmartThings OAuth client secret |
| `refreshToken` | Yes | — | SmartThings OAuth refresh token |
| `deviceId` | No | auto | SmartThings device ID. Omit to auto-discover; set explicitly if you have multiple AC units |
| `pollInterval` | No | `30` | How often (in seconds) to poll device state (10–300) |

## Token Rotation

The SmartThings OAuth refresh token rotates on every use — each token exchange returns a new refresh token. After each successful exchange, the plugin persists the latest token to `homebridge-windfree-roomac-token.json` in the Homebridge storage directory (typically `~/.homebridge`).

On startup, the plugin loads the persisted token if it exists, so restarts across Homebridge sessions work without any manual intervention. The `refreshToken` in `config.json` is only used as the initial token on a fresh install (before any token file has been written).

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Link for local Homebridge testing
npm link
npm link @heschong/homebridge-windfree-roomac   # run in your Homebridge global install directory
```

## License

[MIT](LICENSE)
