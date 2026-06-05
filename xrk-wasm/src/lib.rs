//! wasm-bindgen wrapper over libxrk's pure-Rust core (`read_xrk`), exposing AiM
//! XRK/XRZ parsing to the browser as a small standalone wasm module — no Pyodide,
//! no Python. Returns every channel at its native sample rate (GPS-derived
//! channels merged in, mirroring what libxrk's Python layer does); the JS side
//! resamples onto the GPS timebase (see `src/lib/xrk/xrkResample.ts`).

use serde::Serialize;
use wasm_bindgen::prelude::*;

use libxrk::parser::ChannelValues;
use libxrk::{decompress_if_zlib, read_xrk};

#[derive(Serialize)]
struct ChannelOut {
    name: String,
    units: String,
    /// True when the channel should be linearly interpolated on resample
    /// (continuous signals); false means forward-fill (discrete/state signals).
    interpolate: bool,
    /// Sample timestamps in milliseconds.
    timecodes: Vec<f64>,
    values: Vec<f64>,
}

#[derive(Serialize)]
struct LapOut {
    num: i32,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
struct ParsedOut {
    channels: Vec<ChannelOut>,
    laps: Vec<LapOut>,
    metadata: std::collections::BTreeMap<String, String>,
}

fn values_to_f64(v: &ChannelValues) -> Vec<f64> {
    match v {
        ChannelValues::UInt8(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::UInt16(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::Int16(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::Int32(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::UInt32(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::Float32(a) => a.iter().map(|&x| x as f64).collect(),
        ChannelValues::Float64(a) => a.clone(),
    }
}

/// Parse an AiM `.xrk`/`.xrz` file from raw bytes. Returns a JS object:
/// `{ channels: [{ name, units, interpolate, timecodes, values }], laps, metadata }`.
/// Throws (rejects) a JS string on any parse error.
#[wasm_bindgen]
pub fn parse_xrk(data: &[u8]) -> Result<JsValue, JsValue> {
    let bytes = decompress_if_zlib(data);
    let f = read_xrk(&bytes).map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let mut channels: Vec<ChannelOut> = f
        .channels
        .iter()
        .map(|c| ChannelOut {
            name: c.name.clone(),
            units: c.units.clone(),
            interpolate: c.interpolate,
            timecodes: c.timecodes.iter().map(|&t| t as f64).collect(),
            values: values_to_f64(&c.values),
        })
        .collect();

    // GPS-derived channels live in a separate field on the core result; the
    // Python layer merges them into `channels`, so we do too. They share one
    // timebase (the GPS fix timecodes), which the JS resampler uses as its base.
    if let Some(g) = &f.gps {
        let tc: Vec<f64> = g.timecodes.iter().map(|&t| t as f64).collect();
        let mut push = |name: &str, units: &str, vals: Vec<f64>| {
            channels.push(ChannelOut {
                name: name.into(),
                units: units.into(),
                interpolate: true,
                timecodes: tc.clone(),
                values: vals,
            });
        };
        push("GPS Latitude", "deg", g.latitude.clone());
        push("GPS Longitude", "deg", g.longitude.clone());
        push("GPS Speed", "m/s", g.speed.clone());
        push("GPS Altitude", "m", g.altitude.clone());
        push("GPS_Satellites", "", g.satellites.iter().map(|&x| x as f64).collect());
        push("GPS_pDOP", "", g.pdop.iter().map(|&x| x as f64).collect());
        push("GPS_Position_Accuracy", "m", g.position_accuracy.iter().map(|&x| x as f64).collect());
        push("GPS_Velocity_Accuracy", "m/s", g.velocity_accuracy.iter().map(|&x| x as f64).collect());
        push("GPS_LateralAcc", "g", g.lateral_acc.iter().map(|&x| x as f64).collect());
        push("GPS_InlineAcc", "g", g.inline_acc.iter().map(|&x| x as f64).collect());
        push("GPS_Yaw_Rate", "deg/s", g.yaw_rate.iter().map(|&x| x as f64).collect());
    }

    let laps = f
        .laps
        .iter()
        .map(|l| LapOut { num: l.num, start: l.start_time as f64, end: l.end_time as f64 })
        .collect();

    let mut metadata = std::collections::BTreeMap::new();
    let m = &f.metadata;
    let mut put = |k: &str, v: &Option<String>| {
        if let Some(s) = v {
            if !s.is_empty() {
                metadata.insert(k.to_string(), s.clone());
            }
        }
    };
    put("Driver", &m.driver);
    put("Vehicle", &m.vehicle);
    put("Venue", &m.venue);
    put("Log Date", &m.log_date);
    put("Log Time", &m.log_time);
    put("Session", &m.session);
    put("Series", &m.series);
    put("Device Name", &m.device_name);
    put("Logger Model", &m.logger_model);

    let out = ParsedOut { channels, laps, metadata };
    // serialize_maps_as_objects so `metadata` is a plain JS object, not a Map.
    let ser = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    out.serialize(&ser).map_err(|e| JsValue::from_str(&format!("{e}")))
}
