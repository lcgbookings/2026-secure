import { parseRadioLabel } from '../lib/radio-parser';

const cases = [
  "Sat 13 June, 13:30–17:00",
  "Fri 3 July, 18:00–21:00",
  "Sat 27 June, 13:30–17:00",
  "Sun 14 March, 13:30–17:00",  // year roll forward
  "Wed 17 December, 15:00–18:00",
  "garbage input",
  "",
];

for (const label of cases) {
  const result = parseRadioLabel(label);
  console.log(`"${label}" →`, JSON.stringify(result));
}
