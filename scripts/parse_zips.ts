import fs from 'fs';
import path from 'path';

const csvPath = path.join(process.cwd(), 'src', 'data', 'zipcodes.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

const lines = csvContent.split('\n').filter(line => line.trim() !== '');
const headers = lines[0].split(',');

const zipData: Record<string, string> = {};
const allZips: string[] = [];

for (let i = 1; i < lines.length; i++) {
  // Handle quotes in CSV
  const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
  if (!row) continue;
  
  const zip = row[0].replace(/"/g, '');
  const postOffice = row[2].replace(/"/g, '').replace(/, NY/g, '').trim();
  
  zipData[zip] = postOffice;
  allZips.push(zip);
}

fs.writeFileSync(
  path.join(process.cwd(), 'src', 'data', 'zipcodes.json'),
  JSON.stringify({ zipData, allZips }, null, 2)
);

console.log('Successfully generated zipcodes.json');
