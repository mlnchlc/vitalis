# Bip6 Face

A digital watchface for the **Amazfit Bip 6** (Zepp OS, API level 3.0+).

| Spec | Value |
|---|---|
| Screen | 1.97" AMOLED, 390 × 450, rounded square (r = 86) |
| deviceSource | 9765120, 9765121, 10158337 |
| Preview size | 266 × 307 |

## Layout

- Date (accent colour) at the top
- Large HH:MM time
- Bottom row: steps · heart rate · battery

## Setup

```sh
npm i -g @zeppos/zeus-cli
npm install
zeus dev        # run in the Zepp OS simulator (select Bip 6)
zeus preview    # build + QR code to install on the watch via the Zepp app (Developer Mode)
zeus build      # produce the .zab package
```

## Structure

```
app.json             # app config: targets, deviceSource, permissions
app.js               # app entry
watchface/index.js   # watchface UI + sensor bindings
utils/constants.js   # screen size, colours, labels
assets/bip6/         # images for the bip6 target (icon.png, digits, backgrounds…)
```

Before publishing, replace `appId` in `app.json` with one issued in the Zepp developer console.
Also add a 266 × 307 watchface preview image in `assets/bip6/`.
