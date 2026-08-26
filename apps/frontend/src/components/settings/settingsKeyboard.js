export function activateOnNativeSettingsKey(event, callback) {
  if (event?.key !== 'Enter' && event?.key !== ' ') return false;
  event.preventDefault();
  callback();
  return true;
}
