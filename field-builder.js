const fs = require('fs');
const Jimp = require('jimp');
const toolbox = require('./src/toolbox.js');
const stitch = require('./src/stitch.js');
const rick = require('./src/rick.js');

let WIDE_TYPES = /Battle/;
let FILE_TYPE = "jpg";
const CARD_WIDTH = 375;
const CARD_HEIGHT = 523;
const CARD_OFFSET = 2;
const BATTLE_OFFSET = 74;

const CROP_VALS = {
	DFC: {
		LEFT_HEIGHT_OFFSET: 0,
		LEFT_WIDTH_OFFSET: 0,
		LEFT_HEIGHT: CARD_HEIGHT,
		LEFT_WIDTH: CARD_WIDTH,
		RIGHT_HEIGHT_OFFSET: 0,
		RIGHT_WIDTH_OFFSET: CARD_WIDTH + CARD_OFFSET,
		RIGHT_HEIGHT: CARD_HEIGHT,
		RIGHT_WIDTH: CARD_WIDTH
	},
	TO_BATTLE: {
		LEFT_HEIGHT_OFFSET: 0,
		LEFT_WIDTH_OFFSET: 0,
		LEFT_HEIGHT: CARD_WIDTH,
		LEFT_WIDTH: CARD_HEIGHT,
		RIGHT_HEIGHT_OFFSET: BATTLE_OFFSET,
		RIGHT_WIDTH_OFFSET: CARD_HEIGHT + CARD_OFFSET,
		RIGHT_HEIGHT: CARD_HEIGHT,
		RIGHT_WIDTH: CARD_WIDTH
	},
	FROM_BATTLE: {
		LEFT_HEIGHT_OFFSET: 0,
		LEFT_WIDTH_OFFSET: BATTLE_OFFSET,
		LEFT_HEIGHT: CARD_HEIGHT,
		LEFT_WIDTH: CARD_WIDTH,
		RIGHT_HEIGHT_OFFSET: 0,
		RIGHT_WIDTH_OFFSET: CARD_WIDTH + CARD_OFFSET,
		RIGHT_HEIGHT: CARD_WIDTH,
		RIGHT_WIDTH: CARD_HEIGHT
	},
	DOUBLE_BATTLE: {
		LEFT_HEIGHT_OFFSET: 0,
		LEFT_WIDTH_OFFSET: BATTLE_OFFSET,
		LEFT_HEIGHT: CARD_WIDTH,
		LEFT_WIDTH: CARD_HEIGHT,
		RIGHT_HEIGHT_OFFSET: BATTLE_OFFSET,
		RIGHT_WIDTH_OFFSET: CARD_HEIGHT + CARD_OFFSET,
		RIGHT_HEIGHT: CARD_WIDTH,
		RIGHT_WIDTH: CARD_HEIGHT
	}
}

let new_sets = {};
let run_images = true;
let msem_sets = [];
let rev_sets = [];
let mtg_sets = [];
let error_count = 0;
let stage = 0;

// format files
function prepareFiles() {
	// make sure we have a tokens folder
	fs.mkdir(__dirname + "/files/tokens", (err) => {
		if(err) {
			console.log("tokens folder found");
		}else{
			console.log("tokens folder created");
		}
	});
	// make sure we have an lbfiles folder
	fs.mkdir(__dirname + "/lbfiles", (err) => {
		if(err) {
			console.log("lbfiles folder found");
		}else{
			console.log("lbfiles folder created");
		}
	});
	// make sure we have an final_xmls folder
	fs.mkdir(__dirname + "/final_xmls", (err) => {
		if(err) {
			console.log("final_xmls folder found");
		}else{
			console.log("final_xmls folder created");
		}
	});
	
	// rename folders to their set code
	fs.readdir("./files", (err, fns) => {
		for(let f in fns) {
			let fn = fns[f];
			if(!fn.match(/.txt$/))
				continue;
			
			fs.readFile('./files/'+fn, 'utf8', (err, data) => {
				try {
					let sc, cards;
					let exported = JSON.parse(data);
					if(exported.hasOwnProperty("meta")) {
						sc = exported.meta.setID;
						cards = stitch.arrayExpand(exported.cards);
					}else{
						cards = stitch.arrayExpand(JSON.parse(data));
						let hasParent = false, backSwing = [];
						for(let c in cards) {
							if(cards[c].parentSet) {
								sc = cards[c].parentSet;
								hasParent = true;
							}
							else if(cards[c].setID == "tokens") {
								if(sc) {
									cards[c].parentSet = sc;
								}else{
									backSwing.push(c);
								}
							}
							else if(cards[c].setID != "tokens") {
								sc = cards[c].setID;
							}
							if(sc && hasParent)
								break;
						}
						for(let c in backSwing)
							cards[backSwing[c]].parentSet = sc;
					}
					if(!sc)
						throw `File ${fn} does not have a set code.`;
					if(new_sets.hasOwnProperty(sc)) {
						let ticker = 1;
						let test_sc = sc + ticker;
						while(new_sets.hasOwnProperty(test_sc)) {
							ticker++;
							test_sc = sc + ticker;
						}
						console.log(`${fn}: Set code ${sc} is taken, reassigned to ${test_sc}.`)
						for(let c in cards) {
							if(cards[c].setID == sc) {
								cards[c].setID = test_sc;
							}
							if(cards[c].parentSet == sc) {
								cards[c].parentSet = test_sc;
							}
						}
						sc = test_sc;
					}
					new_sets[sc] = cards;
					
					let folder_name = fn.replace(/(-field-test)?.txt/, "");
					if(!fns.includes(folder_name))
						folder_name += "-files";
					if(!fns.includes(folder_name))
						throw `File ${fn} does not have a matching image folder.`;
					
					if(fn != sc+".txt") {
						fs.rename(`./files/${fn}`, `./files/${sc}.txt`, (err) => {
							if(err)
								throw err;
							console.log(`Renamed ${fn} to ${sc}.txt`);
						});
					}
					if(folder_name != sc) {
						fs.rename(`./files/${folder_name}`, `./files/${sc}`, (err) => {
							if(err)
								throw err;
							console.log(`Renamed ${folder_name} to ${sc}`);
						});
					}
				}catch(e) {
					error_count++;
					console.log(e);
				}
				
			})

		}
	})
}
// combine the files into a single library
async function combineFiles() {
	let cards = {}
	for(let s in new_sets) {
		for(let c in new_sets[s]) {
			cards[c] = new_sets[s][c];
		}
	}
	let setData = {};
	try {
		setData = require('./lbfiles/setData.json');
	}catch(e){
		console.log("No set data provided, using provisional data.");
	}
	
	let library = {
		cards: {},
		setData: {},
		legal: {}
	};
	for(let k in format_args) {
		if(format_args[k].length) {
			let partialLib = await apiPartialLibrary(k);
			if(!partialLib.cards)
				continue;
			for(let s in partialLib.setData) {
				library.setData[s] = partialLib.setData[s];
			}
			for(let c in partialLib.cards) {
				library.cards[c] = partialLib.cards[c];
				library.cards[c].from_lackey = true;
			}
		}
	}
	
	stitch.stitchLibraries(library, {cards:cards, setData:setData});
	
	fs.writeFile('./lbfiles/cards.json', toolbox.JSONfriendly(library.cards), (err) => {
		if(err) {
			console.log(err);
		}else{
			console.log("LackeyBot cards file written.");
		}
	})
	fs.writeFile('./lbfiles/setData.json', JSON.stringify(library.setData, null, 1), (err) => {
		if(err) {
			console.log(err);
		}else{
			console.log("LackeyBot setData file written.");
		}
	})
	
	rick.initialize(library);
	rick.tokenBuilding({
		writeTokens: './final_xmls/tokens.xml'
	});
	rick.cardBuilding({
		writeCards: './final_xmls/cards.xml'
	});
	if(run_images) {
		let trice_names = rick.keysToNames();
		processImages(library, trice_names);
	}
}
function windex(str) {
	str = str.replace(" // ", "");
	str = str.replace(/[\\\/<>:*"?]/g, "");
	return str;
}
function processImages(library, trice_names) {
	// rename normal cards to trice_names[id]
	// split dfcs and rename their images
	console.log("Updating image names...")
	for(let c in library.cards) {
		let card = library.cards[c];
		let names = trice_names[c];
		let si = card.setID;
		if(si == "tokens")
			si = card.parentSet;
		if(card.from_lackey)
			continue;
		let current = `./files/${si}/${card.cardID}.${FILE_TYPE}`;
		fs.exists(current, (exists) => {
			if(!exists)
				return;
			if(names.length > 1) {
				if(card.shape == "doubleface") {
					// split this image, then delete this file
					let b2 = card.typeLine2.match(WIDE_TYPES);
					splitImage(current, `./files/${si}/`, names, b2);
				}else{
					// this file needs duplicated
					forkImage(current, `./files/${si}/`, names);
				}
			}else{
				// rename this file
				let dest = `./files/${card.setID}/${windex(names[0])}.${FILE_TYPE}`;
				fs.rename(current, dest, (err) => {
					if(err)
						console.log(err);
				});
			}
		})
	}
}
function splitImage(fn, dir, names, b2) {
	Jimp.read(fn, (err, img) => {
		if(err) {
			console.log(err);
		}else{
			let shape = CROP_VALS.DFC;
			if(img.bitmap.width >= 2*CARD_HEIGHT) {
				// double battle
				shape = CROP_VALS.DOUBLE_BATTLE;
			}else if(img.bitmap.width >= (CARD_WIDTH+CARD_HEIGHT)) {
				// battle on one side
				shape = CROP_VALS.FROM_BATTLE;
				if(b2)
					shape = CROP_VALS.TO_BATTLE;
			}
			
			img.clone().crop(shape.LEFT_WIDTH_OFFSET, shape.LEFT_HEIGHT_OFFSET, shape.LEFT_WIDTH, shape.LEFT_HEIGHT).write(dir+windex(names[0])+"."+FILE_TYPE);
			img.crop(shape.RIGHT_WIDTH_OFFSET, shape.RIGHT_HEIGHT_OFFSET, shape.RIGHT_WIDTH, shape.RIGHT_HEIGHT).write(dir+windex(names[1])+"."+FILE_TYPE);
			fs.unlink(fn, (er) => {
				if(er)
					console.log(er)
			})
		}
	})
}
function forkImage(fn, dir, names) {
	Jimp.read(fn, (err, img) => {
		if(err) {
			console.log(err);
		}else{
			for(let n = 1; n < names.length; n++) {
				img.clone().write(dir+windex(names[n])+">"+FILE_TYPE);
			}
			fs.rename(fn, dir+windex(names[0])+">"+FILE_TYPE, (er) => {
				if(er)
					console.log(er);
			})
		}
	})
}
async function apiPartialLibrary(k) {
	let format = k.replace(/^--/, "");
	let body = JSON.stringify({format:format, sets:format_args[k]});
	
	let resp = await fetch('https://lackeybot.herokuapp.com/api/library', {
		method: "POST",
		headers: {
		  'Accept': 'application/json',
		  'Content-Type': 'application/json'
		},
		body: body
	})
	
	let s = await streamToString(resp.body);
	let j = {};
	try {
		j = JSON.parse(s);
		j = j.body;
	}catch(e){
		console.log(e);
	}
	
	return j;
}
async function streamToString(stream) {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  let result = '';

  async function read() {
    const { done, value } = await reader.read();

    if (done) {
      return result;
    }

    result += textDecoder.decode(value, { stream: true });
    return read();
  }

  return read();
}

process.on('beforeExit', () => {
	stage++;
	switch(stage) {
		case 1:
			if(error_count > 0) {
				console.log("Terminating script due to errors");
			}else{
				console.log("Everything looks good, preparing files");
				combineFiles();
			}
			break;
		case 2:
			console.log("Finished!");
			break;
	}
})

if(process.argv.includes("--noimages")) {
	run_images = false;
}

// grab sets from command line
let format_args = {
	"--msem": msem_sets,
	"--rev": rev_sets,
	"--revolution": rev_sets,
	"--magic": mtg_sets,
	"--canon": mtg_sets
}
for(let k in format_args) {
	let ind = process.argv.indexOf(k);
	if(ind >= 0) {
		for(let i=ind+1; i<process.argv.length; i++) {
			if(process.argv[i].match(/^-/))
				break;
			format_args[k].push(process.argv[i]);
		}
	}
}

delete format_args["--rev"];
delete format_args["--canon"];

prepareFiles();