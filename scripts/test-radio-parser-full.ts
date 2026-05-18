import { parseFullEventLabel } from '../lib/webhooks/event-matching';

interface Case {
  label: string;
  expect: 'pass' | 'fail';
  description: string;
}

const cases: Case[] = [
  { label: 'Saturday 13th June – London – 1:30pm to 5pm', expect: 'pass', description: 'real radio label, June 13 13:30-17:00' },
  { label: 'Saturday 27th June – London – 1:30pm to 5pm', expect: 'pass', description: 'real radio label' },
  { label: 'Saturday 30th May – London – 2pm to 5pm', expect: 'pass', description: 'no minutes, "2pm" not "2:00pm"' },
  { label: 'Friday 3rd July – London – 6pm to 9pm', expect: 'pass', description: 'Music Box format' },
  { label: 'Saturday 13th June - London - 1:30pm to 5pm', expect: 'pass', description: 'regular hyphens variant' },
  { label: 'Saturday 13th June – Manchester – 10am to 1pm', expect: 'pass', description: 'different location' },
  { label: '', expect: 'fail', description: 'empty' },
  { label: 'Saturday 13th June', expect: 'fail', description: 'no separator' },
  { label: 'Saturday 13th June – London', expect: 'fail', description: 'only 2 parts, no times' },
];

let failures = 0;

for (const c of cases) {
  const r = parseFullEventLabel(c.label);
  const actual = r.success ? 'pass' : 'fail';
  const status = actual === c.expect ? 'PASS' : 'FAIL';
  if (status === 'FAIL') failures += 1;

  if (r.success) {
    console.log(
      `[${status}] ${c.description}\n  input:     "${c.label}"\n  candidate: ${JSON.stringify(r.candidate)}`
    );
  } else {
    console.log(
      `[${status}] ${c.description}\n  input:     "${c.label}"\n  reason:    ${r.reason}`
    );
  }
}

console.log(`\n${failures === 0 ? 'All cases match expectation.' : `${failures} mismatch(es).`}`);
process.exit(failures === 0 ? 0 : 1);
