# NWS Simulator 0.4 — autonomous weather

## Using the simulator

PLAY opens a centered view of the 48 contiguous states. There is no regional dashed box. The simulation initializes by evolving four hours of prior weather so the initial observation can contain existing storms; conditions can also be quiet.

After initialization, weather observations update every **four real minutes**. There are no forward-time buttons, speed controls, weather sliders, storm selectors, or manual forcing controls. The clock shows observation time in UTC. ENV is a read-only monitor. A new weather run resets the simulation and generates new initial variability.

- **RADAR:** select a station by ID or city, product, elevation, and optional velocity folding. LOOP PAST SCANS replays up to 12 scans already collected for that station/product/elevation; LIVE returns to the latest scan. The loop never advances weather. History begins when that product is viewed, so initially there may be only one frame.
- **ENV:** view temperature, dewpoint, CAPE, CIN, shear, development logs, tropical ingredients, and pressure history. Click any city/town location for the local sounding, hodograph and SB/ML/MU parcel diagnostics. Surface state is interpolated continuously between background points; local front/pressure forcing and shallow gust-front winds affect the profile. Nearby towns sharing an air mass may legitimately look similar. Hodograph axes rescale to show stronger winds.
- **JET:** the overlay starts off. The evolving jet exists in the model whether displayed or hidden. Pressure systems move with the modeled upper flow, develop, weaken, and leave the area.
- **SPC:** simulated Day 1–3 categorical and hazard-ingredient guidance. These are uncalibrated favorability contours, not official SPC probabilities or warnings. The areas diagnose support for convection; they do not force storms to occur.
- **MODEL:** GFS-style simulated outlook through day 16; experimental broad outlook through day 30. Choose temperature, pressure, or precipitation favorability. Forecast lead selection never changes observed weather. New runs use the latest atmosphere at six-hour model cycles. Uncertainty grows with lead time; newer runs can revise earlier expectations.

The actual NOAA GFS runs four times daily to 16 days. This application does **not** run NOAA GFS, ingest actual GFS fields, or claim that its 17–30-day extension is GFS. Its uncertainty display is an illustrative spread proxy, not a calibrated confidence interval.

## Weather and storm life cycles

The national background uses an 85 × 53 grid with 70 km spacing, extending beyond CONUS. Subgrid storm cells, precipitation structures and density currents are evaluated independently at radar gates. Finer radar sampling does not imply a 150 m atmospheric model.

Temperature and moisture advect and respond to an idealized solar heat budget, seasonal/large-scale tendencies, moving fronts and cold pools. Autonomous forcing varies gradually with simulation time and initial variability. It is an idealized climate driver, not measured climate or a globally resolved atmosphere.

Virtual-temperature parcel buoyancy supplies CAPE, CIN, LCL, LFC and EL. Profiles have 250 m levels and 50 m parcel ascent substeps. The main positive-energy layer determines the initiation LFC so shallow buoyant pockets cannot hide a cap. Wind profiles give vector bulk shear, storm-relative helicity and a Bunkers-inspired motion estimate. DCAPE remains an explicitly labeled proxy.

Cells initiate only where moisture, buoyancy, inhibition and accumulated lifting permit it. Shear and SRH influence organized rotation. Precipitation can choke weak-shear updrafts; cold outflow can undercut inflow. Loss of instability or inflow fades updrafts and precipitation rather than preserving a named storm indefinitely. Rain decays with a delay, and anvils/trailing precipitation remain after the updraft fades.

Cold pools are separate objects, fed by precipitation and stronger downdrafts during collapse. Their density-current speed depends on temperature deficit and depth. They expand and weaken after the parent storm dies. Their interiors cool/stabilize air; their edges lift warm inflow. Intersecting edges enhance convergence. New cells record the boundary that triggered them. Outflow is not exclusive to pulse storms: organized complexes produce it too.

Persistent outflows affect the radar wind field and may produce shallow fine-line scattering. These echoes are classified as boundary scatter and do not become fake rainfall or VIL. Higher beams increasingly overshoot them. SHOW FRONTS & PRESSURE additionally draws their analysis positions.

Connected cell groups are tracked over time. Shape and orientation distinguish clusters from elongated squall-line/QLCS structures; sustained rotating updrafts support supercell labels. A sufficiently large, persistent group can acquire an MCS label while individual members regenerate. These are approximate diagnostics, not mutually exclusive preset types or operational classification algorithms. An organized system can leave a weak, decaying mesoscale circulation remnant with wind perturbations and conditional lifting.

Derecho remains **unconfirmed**: a bow echo or strong gust alone does not establish a verified long-lived damage swath. The simulator reports organized damaging-wind potential and does not fabricate damage observations. Tornadogenesis, tornado debris, detailed bookend-vortex dynamics, resolved downburst microphysics and exact observed storm reproduction are not claimed.

## Jet, pressure systems and coastal storms

A time-dependent meandering upper-flow field crosses the continent. The same field steers surface lows/highs and influences shear and parameterized development. New lows and following highs arise under supportive upper forcing and air-mass contrast; older systems weaken and are retired. Fronts change local temperature, moisture and ascent. Pressure and isobars use hPa.

Bombogenesis requires a measured model pressure fall over a full 24 hours exceeding 24 × sin(latitude) / sin(60°) hPa. A coastal-low/nor'easter pattern and bombogenesis are distinct diagnostics. Not every coastal low rapidly deepens, and a rapidly deepening inland low is not automatically a nor'easter. This remains parameterized synoptic evolution, not resolved jet-streak divergence or baroclinic instability.

Tropical organization evolves from a weak disturbance with ocean heat, moisture, instability, low shear and ocean residence. Land and hostile conditions weaken it. Eye subsidence suppresses all modeled precipitation sources near the center; eyewall/rainbands and velocity respond to evolving circulation. Wind-based intensity estimates exclude convective gusts. Ocean coupling and potential intensity are simplified.

## Radar inventory and products

`radar-sites.json` bundles the NOAA Office for Coastal Management station inventory retrieved September 21, 2026: **201 sites, including 45 TDWR sites**. Names, identifiers, coordinates and radar types come from that source. This is an inventory snapshot, not a live operational-status feed. It includes KCAE, KAMX, TCLT and stations outside CONUS. Alaska, Hawaii, Puerto Rico and Guam use separate autonomous regional background instances when viewed; these instances are not a globally coupled model. The main map always starts on CONUS.

NEXRAD display: 230 km radius, 1 km / 1° sampling. TDWR airport view: 90 km radius, 150 m / 1° sampling. TDWR Doppler range is shorter; its actual long-range reflectivity mode is not included here. The simulated TDWR azimuth sampling is coarser than real hardware. ZDR, correlation coefficient, KDP and hydrometeor classification are unavailable at TDWR sites because TDWR is single-polarization.

All products share the same precipitation/wind state. Effective 4/3-Earth beam height and radar-relative wind projection affect sampling. Green velocity is toward the radar; red is away. Optional fixed ±60 kt folding is a demonstration rather than hardware-specific PRF simulation. The cursor reads the exact displayed gate, including past scans.

| Product | Model connection / limitation |
|---|---|
| Base reflectivity | Rain, snow, hail and melting proxies; shallow boundary scatter; analytic hydrometeor geometry |
| Composite reflectivity | Maximum height-sampled reflectivity; 1 km vertical spacing |
| Base / storm-relative velocity | Wind projected onto the beam; modeled storm motion subtracted for SRV |
| ZDR / CC / KDP | Empirical drop/phase/hail mixture proxies; no electromagnetic scattering solver |
| Spectrum width | Local turbulence/shear proxy, not a resolved Doppler spectrum |
| Rain rate | Liquid hydrometeor rate; boundary scatter is not rain |
| Accumulation | Time-integrated surface liquid precipitation on the background grid |
| 18 dBZ echo top | Highest sampled level meeting the threshold |
| VIL | 3.44 × 10^-6 integral of Z^(4/7), capped at 56 dBZ; boundary scatter excluded |
| Hydrometeor class | Illustrative rain/hail/snow/melting/freezing-rain/boundary classification |

Terrain, actual radar antenna altitude, attenuation, beam broadening, detailed microphysics, clutter, three-body scatter spikes, full storm-scale vortices and operational QPE are not resolved. This is a **reduced-order educational simulation**, not a validated weather forecast system.

## Research and radar reference review

Sampled frames at 09:20, 13:50, 18:10 and 22:30 local time from the March 31, 2023 NWS St. Louis radar animation were inspected. They show initially sparse echoes, discrete storms/clusters, upscale linear organization and later departure/weakening. The original IEM animation is linked by the NWS event review. Archived Northern Indiana and Iowa case discussions informed outflow collision, regeneration and persistence; some older animation assets were unavailable.

- NWS March 31, 2023 radar animation/event review: https://www.weather.gov/lsx/March312023Severe
- NWS outflow-collision and multicell regeneration case: https://www.weather.gov/iwx/20050808_radaranim
- NWS July 11, 2011 derecho/outflow interaction: https://www.weather.gov/dmx/july112011derecho
- NOAA/NSSL thunderstorm types, life cycles and remnants: https://www.nssl.noaa.gov/education/svrwx101/thunderstorms/types/
- NOAA/NSSL damaging winds: https://www.nssl.noaa.gov/research/wind/
- NWS convective ingredients: https://www.weather.gov/spotterguide/ingredients
- SPC outlook scope: https://www.spc.noaa.gov/about/outlooks/
- NWS dual-pol definitions: https://www.weather.gov/jan/dualpolupgrade-products
- NOAA TDWR specifications: https://www.ncei.noaa.gov/products/radar/terminal-doppler-weather-radar
- NOAA station inventory: https://www.coast.noaa.gov/arcgis/rest/services/Hosted/WeatherRadarStations/FeatureServer/0
- NOAA operational GFS forecast range and cycles: https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php
- NWS nor'easters: https://www.weather.gov/safety/winter-noreaster
- NOAA bombogenesis: https://oceanservice.noaa.gov/facts/bombogenesis.html
- NOAA tropical ingredients: https://oceanservice.noaa.gov/facts/how-hurricanes-form.html
- NHC wind categories: https://www.nhc.noaa.gov/aboutsshws.php

## Verification

`npm test` covers thermodynamics, initiation/suppression, outflow persistence/regeneration, cell decay, organization, national coverage, evolving pressure systems, forecast non-mutation, radar geometry/products, and TDWR restrictions. `smoke.cjs` verifies desktop controls, national startup, absence of editing/fast-forward controls, products, forecast leads, scan timing and history isolation. `NWS_TEST_PACKAGED=1` tests the packaged app. `npm run dist` rebuilds the portable executable.
