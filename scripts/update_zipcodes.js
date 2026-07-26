import fs from 'fs';
import path from 'path';

const suffolkZips = {
  "11701": "Amityville (Suffolk)",
  "11702": "Babylon (Suffolk)",
  "11703": "North Babylon (Suffolk)",
  "11704": "West Babylon (Suffolk)",
  "11705": "Bayport (Suffolk)",
  "11706": "Bay Shore (Suffolk)",
  "11713": "Bellport (Suffolk)",
  "11715": "Blue Point (Suffolk)",
  "11716": "Bohemia (Suffolk)",
  "11717": "Brentwood (Suffolk)",
  "11718": "Brightwaters (Suffolk)",
  "11719": "Brookhaven (Suffolk)",
  "11720": "Centereach (Suffolk)",
  "11721": "Centerport (Suffolk)",
  "11722": "Central Islip (Suffolk)",
  "11724": "Cold Spring Harbor (Suffolk)",
  "11725": "Commack (Suffolk)",
  "11726": "Copiague (Suffolk)",
  "11727": "Coram (Suffolk)",
  "11729": "Deer Park (Suffolk)",
  "11730": "East Islip (Suffolk)",
  "11731": "East Northport (Suffolk)",
  "11733": "Setauket (Suffolk)",
  "11738": "Farmingville (Suffolk)",
  "11740": "Greenlawn (Suffolk)",
  "11741": "Holbrook (Suffolk)",
  "11742": "Holtsville (Suffolk)",
  "11743": "Huntington (Suffolk)",
  "11746": "Huntington Station (Suffolk)",
  "11747": "Melville (Suffolk)",
  "11749": "Islandia (Suffolk)",
  "11751": "Islip (Suffolk)",
  "11752": "Islip Terrace (Suffolk)",
  "11754": "Kings Park (Suffolk)",
  "11755": "Lake Grove (Suffolk)",
  "11763": "Medford (Suffolk)",
  "11764": "Miller Place (Suffolk)",
  "11766": "Mount Sinai (Suffolk)",
  "11767": "Nesconset (Suffolk)",
  "11768": "Northport (Suffolk)",
  "11769": "Oakdale (Suffolk)",
  "11772": "Patchogue (Suffolk)",
  "11776": "Port Jefferson Station (Suffolk)",
  "11777": "Port Jefferson (Suffolk)",
  "11778": "Rocky Point (Suffolk)",
  "11779": "Ronkonkoma (Suffolk)",
  "11780": "Saint James (Suffolk)",
  "11782": "Sayville (Suffolk)",
  "11784": "Selden (Suffolk)",
  "11786": "Shoreham (Suffolk)",
  "11787": "Smithtown (Suffolk)",
  "11788": "Hauppauge (Suffolk)",
  "11789": "Sound Beach (Suffolk)",
  "11790": "Stony Brook (Suffolk)",
  "11792": "Wading River (Suffolk)",
  "11795": "West Islip (Suffolk)",
  "11796": "West Sayville (Suffolk)",
  "11798": "Wyandanch (Suffolk)",
  "11901": "Riverhead (Suffolk)",
  "11930": "Amagansett (Suffolk)",
  "11932": "Bridgehampton (Suffolk)",
  "11933": "Calverton (Suffolk)",
  "11934": "Center Moriches (Suffolk)",
  "11937": "East Hampton (Suffolk)",
  "11940": "East Moriches (Suffolk)",
  "11944": "Greenport (Suffolk)",
  "11946": "Hampton Bays (Suffolk)",
  "11949": "Manorville (Suffolk)",
  "11950": "Mastic (Suffolk)",
  "11951": "Mastic Beach (Suffolk)",
  "11952": "Mattituck (Suffolk)",
  "11953": "Middle Island (Suffolk)",
  "11954": "Montauk (Suffolk)",
  "11963": "Sag Harbor (Suffolk)",
  "11967": "Shirley (Suffolk)",
  "11968": "Southampton (Suffolk)",
  "11970": "Southold (Suffolk)",
  "11978": "Westhampton Beach (Suffolk)",
  "11980": "Yaphank (Suffolk)"
};

const zipcodesPath = path.join(process.cwd(), 'data', 'zipcodes.json');
const currentData = JSON.parse(fs.readFileSync(zipcodesPath, 'utf-8'));

const updatedZipData = { ...currentData.zipData, ...suffolkZips };
const allZipsSet = new Set([...currentData.allZips, ...Object.keys(suffolkZips)]);
const sortedAllZips = Array.from(allZipsSet).sort();

const result = {
  zipData: updatedZipData,
  allZips: sortedAllZips
};

fs.writeFileSync(zipcodesPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`Updated zipcodes.json successfully! Total zip codes: ${sortedAllZips.length}`);
