const config = require('../config.json');
const languageConfig = require('../languages.json');
const fs = require('fs');

let data = require(`../data/${config.sourceFile}`);
let cleaned = [];
let output = [];

// 4000 Record title / Artist <= Record title is actually side A
// 4212 Alternative title (remove "Abweichender Titel: ")
// 4222 Side A (Remove "$t", remove "Enth. außerdem:" split by ".") <= Side A is actually Side B
// 3260 Side B
// 4221 Language (Remove "Sprache: ")
// 1100 YEAR$n[YEAR]
// 3010 Performer (Remove "!xxx!" and anything after "$"")
// 3110 Performing band, group (Remove "!xxx!" and anything after "$"")
// 2301 Record Number
// 4060 Schallplatte (Shellack)
// 6535 Type (Filter: "Musik", "12.3 Musik" "12.3 Afrikanische Musik")
// 4061 78 UpM, Mono
// 4201 Commentary (barcodes separated with / and prefixed with "Matrix-Nr.: ")

/**
 * Only keep the "diag" property.
 * @param {Array} data 
 */
const filterDiag = (data) => {
  return data.filter(element => element.type === "diag");
}

/**
 * Flatten objects.
 * @param {Array} data 
 */
const flattenHierarchy = (data) => data.map(element => element.data);

/**
 * Filter out Anything that's not music (i.e. comedy, audiobooks, etc.)
 * @param {Array} data 
 */
const filterMusic6535 = (data) => {
  return data.filter(element => {
    const el = element['6535'] && element['6535'][0];
    if (el === "Musik" || el === "12.3 Musik" || el === "12.3 Afrikanische Musik") {
      return element;
    }
  });
}


const buildRecord = (data) => {
  return data.map((record) => {
    let title = '';
    let alternativeTitle = '';
    let artist = '';
    let performer = '';
    let band = '';
    let year = '';
    let label = '';
    let language = '';
    let location = '';
    let physical = '';
    let catNo = '';
    let barcodes = [];
    let tracks = {};


    // Split the format "Record title / Artist"
    if (record['4000'] && record['4000'][0]) {
      const split = record['4000'][0].split(' / ');
      title = split[0].replace(' [[Tonträger]]', '');
      artist = split[1];
    }
    
    // Parse the alternative title
    if (record['4212'] && record['4212'][0]) {
      // Remove german labeling
      alternativeTitle = record['4212'][0].replace('Abweichender Titel: ', '');
    }

    // Add "single" performer
    if (record['3010'] && record['3010'][0]) {
      performer = cleanFieldPerformer(record['3010'][0]);
    }

    // Add band
    if (record['3110'] && record['3110'][0]) {
      band = cleanFieldPerformer(record['3110'][0]);
    }

    // Add year
    if (record['1100'] && record['1100'][0]) {
      year = record['1100'][0].split('$')[0];
    }

    // Add language
    if (record['4221'] && record['4221'][0]) {
      language = extractLanguages(record['4221'][0]);
    }

    // Extract label and location
    if (record['4030'] && record['4030'][0]) {
      let labelLocation = record['4030'][0];
      if (labelLocation) {
        // Remove '{[S.l.]'
        labelLocation = labelLocation.replace('{[S.l.]', '').replace('[S.l.]', '');
        // Remove any text in brackets [] that include the word "ermittelbar"
        labelLocation = labelLocation.replace(/\[([^\][]*)ermittelbar([^\][]*)\]/gi, '');
        // Split into location and label
        labelLocation = labelLocation.split(' : ');

        if (labelLocation[0]) {
          location = labelLocation[0];
          location = location.replace(' :', '');
          location = extractBetweenBrackets(location).trim();
        }
        if (labelLocation[1]) {
          label = extractBetweenBrackets(labelLocation[1]);          
        }
      }
    }

    // Add physical medium
    if (record['4060'] && record['4060'][0]) {

      physical = record['4060'][0]
        .replace('1 ', '')
          .replace('2 ', '')
          .replace('Paris : Africa production', '')
          .replace('Schellack', 'Shellack')
          .replace('Schallpl.', 'Vinyl Record')
          .replace('Schallplatte', 'Vinyl Record')
          .replace('Tonkassette', 'Cassette Tape')
          .replace('Audiokassette', 'Cassette Tape');
        
    }

    // Add Record Number
    if (record['2301'] && record['2301'][0]) {
      catNo = record['2301'][0];
    }

    // Add barcodes
    if (record['4201'] && record['4201'][0]) {
      let codes = record['4201'][0]
      
      // Make sure we only work with records prefixed by "Matrix-Nr.:"
      if (codes.indexOf('Matrix-Nr.:') !== -1) {
        codes = codes.replace('Matrix-Nr.:', '').trim();
        barcodes = codes.split('/');
      }
    }
    
    // Add tracks
    tracks = extractTracks(record);
    
    return {
      ...record,
      cleaned: {
        title, alternativeTitle, artist, performer, band, year, label, language, location, physical, catNo, barcodes, tracks
      }
    }
  });
}

const cleanFieldPerformer = (field) => {
  // Performers are prefixed with a number surrounded by exclamation marks
  const prefix = /!([0-9]*)!/;
  field = field.replace(prefix, '');

  // Drop everything after "$B"
  field = field.split('$B')[0];

  return field;
}

/**
 * Checks for persistence of any of the configured languaged and returns the translated version.
 * @param {string} field 
 */
const extractLanguages = (field) => {
  return Object.keys(languageConfig).reduce((result, language) => {
    if (field.toLowerCase().indexOf(language.toLowerCase()) !== -1) {
      // Return the translated string
      result.push(languageConfig[language]);
    }
    return result;
  }, [])
}

const extractTracks = (record) => {
  const sideA = extractSideA(record) || [];
  const sideB = extractSideB(record) || [];

  return {
    // Concatenate side a and side b but remove any duplicates.
    "all": Array.from(new Set(sideA.concat(sideB))),
    "side_a": sideA,
    "side_b": sideB
  };
}

// const extractSideA = (record) => {
//   // 4222 Side A (Remove "$t", remove "Enth. außerdem:" split by ".")
//   if (record['4222'] && record['4222'][0]) {
//     const titles = record['4222'][0].replace('$t', '').replace('Enth. außerdem:', '').split('. ');
//     return titles.map(title => title.trim());
//   }
// }

const extractSideA = (record) => {
  // 4222 Side A (Remove "$t", remove "Enth. außerdem:" split by ".")
  if (record['4000'] && record['4000'][0]) {
    const split = record['4000'][0].split(' / ');
    return [split[0].replace(' [[Tonträger]]', '')];
  }
}

// const extractSideB = (record) => {
//   if (record['3260'] && record['3260'][0]) {
//     return [record['3260'] && record['3260'][0]];
//   }
// }

const extractSideB = (record) => {
  // 4222 Side A (Remove "$t", remove "Enth. außerdem:" split by ".")
  if (record['4222'] && record['4222'][0]) {
    const titles = record['4222'][0].replace('$t', '').replace('Enth. außerdem:', '').split('. ');
    return titles.map(title => title.trim());
  }
}

const arrEquals = (array1, array2) => {
  return !arrEmpty(array1) && !arrEmpty(array2) && array1.length === array2.length && array1.every((value, index) => value === array2[index])
}
const arrEmpty = arr => arr && arr.length === 0;

const extractBetweenBrackets = (string) => {
  let match = string.match(/\[(.*?)\]/); 
  if (match) {
    return match[1]
  } else {
    return string.replace('[', '');
  }
}


cleaned = filterMusic6535(flattenHierarchy(filterDiag(data)));
output = buildRecord(cleaned);
output = output.filter(record => record.cleaned.tracks['side_a']);
output = output.map(element => element.cleaned);
output = output.filter(record => !arrEquals(record.tracks.side_a, record.tracks.side_b));
//output = output.slice(0, 10);

console.log(JSON.stringify(output, null, 2));
