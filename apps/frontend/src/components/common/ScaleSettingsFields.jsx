import React from 'react';
import { SCALE_PROFILES } from '../../utils/weightScaleParser';

const fieldClass = 'border rounded bg-background px-2 py-1 w-full';
export default function ScaleSettingsFields({ value, onChange, disabled = false }) {
  const select = (key, label, values, numeric = false) => (
    <label className="block text-sm space-y-1" key={key}>
      <span>{label}</span>
      <select className={fieldClass} value={value[key]} disabled={disabled}
        onChange={event => onChange(key, numeric ? Number(event.target.value) : event.target.value)}>
        {values.map(option => <option key={option.id ?? option} value={option.id ?? option}>{option.label ?? option}</option>)}
      </select>
    </label>
  );
  return <div className="space-y-3">
    <div className="grid sm:grid-cols-3 gap-3">
      {select('profileId', 'Protocol', SCALE_PROFILES)}
      {select('baudRate', 'Baud rate', [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200], true)}
      {select('unit', 'Integer-profile unit', ['kg', 'g', 'lb', 'oz'])}
      <label className="block text-sm space-y-1"><span>Integer decimal places</span>
        <input className={fieldClass} type="number" min="0" max="6" step="1" value={value.decimalPlaces}
          disabled={disabled} onChange={event => onChange('decimalPlaces', Number(event.target.value))}/>
      </label>
      {select('dataBits', 'Data bits', [7, 8], true)}
      {select('parity', 'Parity', ['none', 'even', 'odd'])}
      {select('stopBits', 'Stop bits', [1, 2], true)}
      {select('flowControl', 'Flow control', ['none', 'rtscts'])}
    </div>
    <p className="text-xs text-muted-foreground">For bracket messages, the integer is divided by 10 raised to the decimal setting.
      With the default kg / 2 settings, [03626] means 36.260 kg. Display formatting does not determine this setting.</p>
  </div>;
}
