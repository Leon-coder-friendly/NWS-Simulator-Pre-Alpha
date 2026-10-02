# Meteorology lab — version 0.2.0

## Playing

Launch `release/NWS Simulator.exe`, choose PLAY, then RADAR. Choose a weather scenario; it selects a nearby radar and focuses the map. Switch products without changing the underlying storm. Use the crosshair to sample that field, including range and beam height. PLAY advances five simulated minutes every 1.8 seconds; +5 MIN steps manually. Animation stops at three hours; RESET restores the initial scene. A storm can move out of radar coverage. Changing radar sites does not relocate the weather.

JET STREAM starts disabled. Clicking its toolbar button enables it; HIDE JET STREAM disables it. Pattern buttons select three illustrative 250 hPa regimes. Upper-level wind speed is not bulk vertical wind shear.

SHOW FRONTS & PRESSURE displays cold, warm, stationary and occluded front symbols where appropriate, drylines, troughs, pressure centers and illustrative isobars. Tropical scenarios have no surface fronts. Coastal extratropical scenarios use an occluded low and cold-sector precipitation. Turn off the radar or reset the view to inspect the larger synoptic pattern.

## What is modeled

Nine deterministic scenarios: classic supercell, QLCS, MCS, stratiform rain, precipitating cumulonimbus multicells, tropical storm, Category 2 hurricane, nor’easter and an explosively deepening extratropical cyclone. Supercell hooks and a cyclonic wind field share their location. A hook is not proof of a tornado. Clear-air cumulus is not painted as precipitation. The QLCS has a bowed leading line, rear inflow and trailing stratiform rain; MCS is a broader category that can include QLCSs.

Ten products use the same analytic precipitation and wind field: base and composite reflectivity, radial and storm-relative velocity, ZDR, correlation coefficient, KDP, rain rate, 18 dBZ echo tops and hydrometeor class. Product legends have separate palettes and units. Green Doppler velocities are toward the radar, red away. The dot product of horizontal wind with the radar look direction determines radial velocity; scenario translation is removed for storm-relative velocity. No echo means no base velocity return. Products are idealized/dealiased; there is no velocity folding.

The scan covers 230 km with 50/100/150/230 km range rings and 0.5/1.5/2.4/4 degree tilts. An effective 4/3-Earth radius estimates beam-center height relative to the radar; shallow precipitation can be overshot. Composite and echo tops represent a synthetic column and do not vanish merely because one chosen tilt overshoots it. Local distances use an equirectangular approximation and omit terrain/radar altitude.

Rain rate uses the illustrative Z=200 R^1.6 relationship with hail capping and frozen-precipitation masking. Dual-polarization moments, phase class and echo tops are empirical teaching proxies, not NEXRAD retrieval algorithms or a simulated scattering calculation. Hail reduces CC and ZDR; uniform liquid precipitation has high CC. No debris detection or automatic tornado claim is fabricated.

Tropical categories use maximum sustained surface wind, not pressure. The tropical storm is 50 kt, the hurricane 90 kt (Category 2). Nor’easters have counterclockwise circulation and northeasterly winds northwest of the coastal center. The bomb scenario specifies a historical 30 hPa fall over the preceding 24 hours, compared with 24 sin(latitude)/sin(60 degrees). The comparison is latitude-adjusted. It does not classify every deep low as a bomb cyclone.

## Limits

This is an educational, kinematic model, not a numerical weather prediction system or operational NWS product. Animation translates idealized structures and modestly pulses echo intensity. It does not solve atmospheric dynamics, microphysics, landfall weakening, storm genesis/decay, snow accumulation, flooding or storm surge. Pressure history is scenario metadata, not an integrated pressure tendency. Isobars/front placement illustrate the selected regime rather than being diagnosed from gridded thermodynamics. Offshore echoes remain visible.

Legacy SPC outlooks and point profiles/sounding drawings remain illustrative and are not dynamically derived from the new radar scenarios. They must not be interpreted as physically consistent forecast guidance. The application labels point profiles and all radar data as simulated. No live observations are downloaded.

## References used

- NWS radar moments and dual polarization: https://www.weather.gov/bmx/radar_dualpol
- NWS dual-pol definitions: https://www.weather.gov/jan/dualpolupgrade-products
- NWS radial velocity sign and geometry: https://www.weather.gov/cle/Area_Radars
- NWS hook echoes and velocity signatures: https://www.weather.gov/bmx/radar_aboutnwsradar_keyindicators
- NWS nor’easter definition: https://www.weather.gov/safety/winter-noreaster
- NOAA latitude-adjusted bombogenesis: https://oceanservice.noaa.gov/facts/bombogenesis.html
- NHC hurricane wind scale: https://www.nhc.noaa.gov/aboutsshws.php

## Development checks

`npm test` runs numerical and structural field checks. `node_modules/electron/dist/electron.exe smoke.cjs` exercises the desktop renderer across all nine scenarios and ten products, checks startup/toggle behavior, steps/resets the simulation, and writes screenshots to `qa`. Run without ELECTRON_RUN_AS_NODE. `npm run dist` rebuilds the portable Windows app.
