// Experiments must never change a normal preview or wallpaper. Reload between trials
// so every run starts with the same scene, random seeds and simulation clock.
export function measurementOptions(query) {
  if (query.get('diagnostics') !== '1') return {};
  const options = {};
  for (const key of ['particles', 'ao', 'plants']) {
    if (query.get(key) === '0') options[key] = false;
  }
  for (const [key, allowed] of Object.entries({
    resolution: [0.75, 1, 1.15, 1.25],
    shadowHz: [0, 5, 10, 15, 30],
    fps: [20, 30, 60],
  })) {
    if (!query.has(key)) continue;
    const value = Number(query.get(key));
    if (query.get(key).trim() !== '' && allowed.includes(value)) options[key] = value;
  }
  return options;
}

export function measurementSettings(settings, options) {
  return {
    ...settings,
    ...(options.resolution !== undefined ? { resolution: options.resolution } : {}),
    ...(options.shadowHz !== undefined ? { shadowHz: options.shadowHz } : {}),
    ...(options.ao === false ? { aoSamples: 0 } : {}),
  };
}
