/*
	Stitch
	combines and updates cards.json files
*/

const fs = require('fs');
const toolbox = require('./toolbox.js');

const numbers = ["X", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const countlines = numbers.join("|") + "|an|a";
const conjstr = 'conjures? (' + countlines + ')(?: cards? named)? (.+?)(?: and shuffle| then shuffle| into| onto| on top|\. Shuffle|\. Put| and put)';
const conjureRegex = new RegExp(conjstr, 'i');
const conjureRegexG = new RegExp(conjstr, 'ig');
const cli = (require.main === module);
var tag_cache = {};

function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
function backupCards(format) {
	fs.copyFile(`${format}/cards.json`, `${format}/cards_backup.json`, (err) => {
		if(err) {
			console.log("Error in making backup, cards have not been modified.");
			console.log(err);
		}else{
			console.log("Backup made");
			if(cb) {
				cb();
			}
		}
	})
}

function stitchLibraries(lib, newlib) {
	let cards = lib.cards;
	let setData = lib.setData;
	let newcards = newlib.cards;
	let sdnMax = 0;
	
	let nextNo = 1;
	for(let s in setData) {
		let rn = parseInt(setData[s].releaseNo);
		if(rn > nextNo)
			nextNo = rn + 1;
	}
	
	// printings that have had a major change
	let changedPrints = {};
	// changelong entries
	let changelog = {
		updated: [],
		sets: [],
		added: {},
		patchInfo: []
	}
	
	// step 1, copy information from newlib
	if(cli)
		console.log("Stitching cards...");
	for(let card in newcards) {
		if(cards[card]) {
			// this is an existing card that we're updating
			let changeArray = majorChange(cards[card], newcards[card]);
			if(changeArray.length) {
				// a major change has occured, record it
				if(!changedPrints[newcards[card].cardName])
					changedPrints[newcards[card].cardName] = {};
				changedPrints[newcards[card].cardName][card] = changeArray;
			}
			
			// backup any data the MSE exporter doesn't have
			// notes
			for(let n in cards[card].notes) {
				if(!newcards[card].notes.includes(cards[card].notes[n]))
					newcards[card].notes.push(cards[card].notes[n]);
			}
			// statDex Number
			if(cards[card].sdn !== undefined)
				newcards[card].sdn = cards[card].sdn;
			// champion marker
			if(cards[card].champion)
				newcards[card].champion = cards[card].champion;
			// lair Number
			if(cards[card].lair)
				newcards[card].lair = cards[card].lair;
			// tokenscripts
			if(cards[card].hasOwnProperty("tokenscripts") && !newcards[card].hasOwnProperty("tokenscripts"))
				newcards[card].tokenscripts = cards[card].tokenscripts;
			
			// overwrite the card
			cards[card] = newcards[card];
			changelog.updated.push(card);
			let updateInfo = {name: card, setID: cards[card].setID, cardID: cards[card].cardID, patchNote: ""};
			if(cards[card].patchNote) {
				updateInfo.patchNot = cards[card].patchNote;
				delete cards[card].patchNote;
			}
			changelog.patchInfo.push(updateInfo);
		}
		else{
			// this is a new card that we're adding
			cards[card] = newcards[card];
			if(!changelog.added[newcards[card].setID])
				changelog.added[newcards[card].setID] = [];
			changelog.added[newcards[card].setID].push(card);
			if(newcards[card].setID != "tokens" && !lib.setData[newcards[card].setID]) {
				changelog.sets.push(newcards[card].setID);
				lib.setData[newcards[card].setID] = {
					longname: "",
					Design: "",
					Link: "",
					releaseNo: nextNo,
					releaseDate: "",
					Draft: 0,
					basics: 0,
					masterpiece: false,
					packSlots: []
				}
				nextNo++;
				if(newlib.setData[newcards[card].setID])
					lib.setData[newcards[card].setID] = newlib.setData[newcards[card].setID];
			}
		}
		if(newcards[card].tokenscripts) {
			let alias = newcards[card].tokenscripts.t;
			if(alias) {
				if(!tag_cache[alias]) {
					tag_cache[alias] = [];
				}
				tag_cache[alias].push(card);
			}
		}
	}
	
	// step 2, recalculate metadata
	if(cli)
		console.log("Calculating metadata...");
	let printsHold = {};
	let numberConflicts = {};
	
	for(let card in cards) {
		let thisCard = cards[card];
		let cn = thisCard.cardName;
		let si = thisCard.setID;
		if(!printsHold[cn]) {
			printsHold[cn] = {
				prints: [],
				rarities: [],
				allRefs: [],
				firstPrint: "",
				firstInd: 999
			}
		}
		let thisPrints = printsHold[cn];
		if(!thisCard.notes)
			thisCard.notes = [];
		// add this reference
		thisPrints.allRefs.push(card);
		// add this setID
		if(si != "tokens" && !thisPrints.prints.includes(si))
			thisPrints.prints.push(si);
		// add this rarity
		if(si != "tokens" && !thisPrints.rarities.includes(thisCard.rarity))
			thisPrints.rarities.push(thisCard.rarity);
		// check firstPrint
		let fpo = firstPrintOverride(cn);
		if(fpo) {
			// override for retroactive reprints
			thisPrints.firstPrint = fpo;
			thisPrints.firstInd = 0;
		}
		else if(lib.setData[si] && !lib.setData[si].reprint) {
			// reprint only sets are never first prints
			// if this was from an earlier set, assign as first print set
			let setInd = parseInt(lib.setData[si].releaseNo);
			if(setInd < thisPrints.firstInd) {
				thisPrints.firstInd = setInd;
				thisPrints.firstPrint = card;
			}
		}
		
		// correct colorIdentity field
		colorFixer(thisCard);
		// correct designers
		designerFixer(thisCard, lib);
		// add lair number
		if(thisCard.hidden && thisCard.setID == "LAIR") {
			let slpull = thisCard.hidden.match(/[(](?:[^ ]+ )?SL(\d+)/);
			if(slpull)
				thisCard.lair = slpull[1];
		}
		// process spellbooks
		if(!thisCard.spellbook) {
			let sb = [];
			let conjG = thisCard.rulesText.match(conjureRegexG);
			for(let g in conjG) {
				let match = conjG[g].match(conjureRegex);
				let amount = match[1];
				let name = match[2];
				let count = numbers.indexOf(amount);
				if(count < 1)
					count = 1;
				let cname = locateConjuredCard(name, thisCard, cards);
				for(let i=0; i<count; i++) {
					sb.push(cname);
				}
			}
			let codMatch = thisCard.rulesText.match(/Codex ?— ?(([^;.\n(*]+)[;.])+/);
			if(codMatch) {
				let list = codMatch[0].replace(/(^Codex ?— ?|\.$)/g, "").split("; ");
				if(sb.length == 0) {
					sb = list;
				}else{
					for(let l in list) {
						sb.push(list[l]);
					}
				}
			}
			thisCard.spellbook = sb;
		}
		// process tokenscripts
		if(thisCard.tokenscripts) {
			if(thisCard.tokenscripts.c) {
				// format spellbook
				thisCard.spellbook = [];
				let names = thisCard.tokenscripts.c.split(";");
				for(let n=0; n<names.length; n+=2) {
					let name = names[n];
					let val = names[n+1];
					if(!name || !val)
						continue;
					val = parseInt(val);
					if(!val)
						val = 1;
					let cname = locateConjuredCard(name, thisCard, cards);
					for(let i=0; i<val; i++) {
						thisCard.spellbook.push(cname);
					}
				}
			}
			if(thisCard.tokenscripts.rr) {
				// format replace script
				thisCard.tokenscripts.r = [];
				let spellreset = false;
				let names = thisCard.tokenscripts.rr.split(";");
				for(let n=0; n<names.length; n+=2) {
					let name = names[n];
					let val = names[n+1];
					if(!name || !val)
						continue;
					let conj = false;
					let ctest = val.match(/conjured?: ?(.*)/);
					if(ctest) {
						conj = true;
						val = ctest[1];
					}
					let trans = false;
					if(val.match(/transform/i)) {
						val = "1";
						trans = true;
					}
					if(val == "x")
						val = "X"
					if(val != "X")
						val = parseInt(val);
					if(conj) {
						if(!thisCard.hasOwnProperty("spellbook") || !spellreset) {
							thisCard.spellbook = [];
							spellreset = true;
						}
						let cname = locateConjuredCard(name, thisCard, cards);
						let amount = (val == "X" ? 1 : val);
						for(let i=0; i<amount; i++)
							thisCard.spellbook.push(cname);
					}else if(trans) {
						thisCard.tokenscripts.r.push([name, "transform", "transform"])
					}else{
						thisCard.tokenscripts.r.push([name, val])
					}
				}
				delete thisCard.tokenscripts.rr;
			}
			if(thisCard.tokenscripts.aa) {
				// format add script
				thisCard.tokenscripts.a = [];
				let names = thisCard.tokenscripts.aa.split(";");
				for(let n=0; n<names.length; n+=2) {
					let name = names[n];
					let val = names[n+1];
					if(!name || !val)
						continue;
					let conj = false;
					let ctest = val.match(/conjured?: ?(.*)/);
					if(ctest) {
						conj = true;
						val = ctest[1];
					}
					let trans = false;
					if(val.match(/transform/i)) {
						val = "1";
						trans = true;
					}
					if(val == "x")
						val = "X"
					if(val != "X")
						val = parseInt(val);
					if(conj) {
						if(!thisCard.hasOwnProperty("spellbook"))
							thisCard.spellbook = [];
						let cname = locateConjuredCard(name, thisCard, cards);
						let amount = (val == "X" ? 1 : val);
						for(let i=0; i<amount; i++)
							thisCard.spellbook.push(cname);
					}else if(trans) {
						thisCard.tokenscripts.a.push([name, "transform", "transform"]);
					}else{
						thisCard.tokenscripts.a.push([name, val]);
					}
				}
				delete thisCard.tokenscripts.aa;
			}
		}
		// save formats
		thisCard.formats = renderFormats(thisCard, lib);
		// track sdnMax
		if(thisCard.sdn && thisCard.sdn > sdnMax)
			sdnMax = thisCard.sdn;
		
		// check number conflicts
		let lID = thisCard.setID + "/" + thisCard.cardID;
		if(!numberConflicts[lID])
			numberConflicts[lID] = [];
		numberConflicts[lID].push(card);
		
		// save sorting name
		thisCard.sortName = cn.replace(/ /g, "_").replace(/'/g, "_'");
	}
	
	// step 3, sort cards and apply metadata
	if(cli)
		console.log("Sorting cards...");
	let cardOrder = Object.keys(cards);
	cardOrder.sort(function(a, b) {
		let aCate = 0, bCate = 0;
		if(cards[a].setID == "tokens") {
			aCate = 2;
		}else if(cards[a].rarity == "special") {
			aCate = 1;
		}
		if(cards[b].setID == "tokens") {
			bCate = 2;
		}else if(cards[b].rarity == "special") {
			bCate = 1;
		}
		if(aCate != bCate)
			return aCate-bCate;
		let ar = 0, br = 0;
		if(setData[cards[a].setID])
			ar = parseInt(setData[cards[a].setID].releaseNo);
		if(setData[cards[b].setID])
			br = parseInt(setData[cards[b].setID].releaseNo);
		if(ar > 0 && br > 0 && ar != br)
			return ar-br;
		if(cards[b].sortName < cards[a].sortName)
			return 1;
		return -1;
	})
	
	let finalCards = {};
	for(let cn in cardOrder) {
		let thatCard = cards[cardOrder[cn]];
		finalCards[cardOrder[cn]] = thatCard;
		let thisCard = finalCards[cardOrder[cn]];
		let si = thisCard.setID;
		let thisPrints = printsHold[thisCard.cardName];
		
		delete thisCard.sortName;
		thisCard.prints = thisPrints.prints;
		thisCard.rarities = thisPrints.rarities;
		thisCard.firstPrint = thisPrints.firstPrint;
		
		if(si == "tokens") {
			delete thisCard.sdn;
			thisCard.firstPrint = "";
		}else if(thisCard.sdn === undefined) {
			sdnMax++;
			thisCard.sdn = sdnMax;
		}
		
		// check reprint tag
		if(thisCard.firstPrint == cardOrder[cn]) {
			// if we're firstPrint and have a reprint tag, remove it
			let rpInd = thisCard.notes.indexOf("reprint");
			if(rpInd)
				thisCard.notes.splice(rpInd, 1);
		}
		else if(thisCard.firstPrint != "" && !thisCard.notes.includes("reprint")) {
			// otherwise we need to make sure we have it
			thisCard.notes.push("reprint");
		}
		// check revolution tag exemption
		if(lib.legal.rotation && thisCard.notes.includes("reprint")) {
			// tag exemption doesn't get removed, and only applies to the newest set
			// so ignore cards from older sets
			if(thisCard.setID == legal.rotation[legal.rotation.length-1]) {
				// if any of our other printings are both
				// a) currently in rotation, and
				// b) firstPrint or exempt
				// then we're not exempt. otherwise we are.
				let exempt = true;
				for(let r in thisPrints.allRefs) {
					let id = thisPrints.allRefs[r];
					let otherPrint = cards[id];
					let otherSet = otherPrint.setID;
					if(lib.legal.rotation.includes(otherSet)) {
						// set is in rotation
						if(otherPrint.firstPrint == id || otherPrint.notes.includes("tag_exempt")) {
							exempt = false;
							break;
						}
					}
				}
			}
		}
		
	}
	
	// step 4, report changelog
	if(cli) {
		console.log("Changes:");
		for(let s in changelog.sets) {
			console.log(`Added provisional set: ${changelog.sets[s]}`);
		}
		for(let s in changelog.added) {
			console.log(`Added ${changelog.added[s].length} cards to ${s}`)
		}
		for(let u in changelog.updated) {
			console.log(`Updated ${changelog.updated[u]}`);
		}
	}
	// step 5, check for number conflics
	if(cli)
		console.log("Checking for number conflicts...")
	for(let n in numberConflicts) {
		if(numberConflicts[n].length > 1) {
			console.log(`Number conflict at ${n} for ${numberConflicts[n].join(";")}`);
		}
	}
	
	// step 6, verify new reprints are valid
	if(cli)
		console.log("Verifying new reprints...");
	for(let s in changelog.added) {
		for(let c in changelog.added[s]) {
			let id = changelog.added[s][c];
			let card = finalCards[id];
			if(card.firstPrint == id || card.firstPrint == "")
				continue;
			let changeArray = majorChange(card, finalCards[card.firstPrint]);
			if(cli && changeArray.length > 0) {
				console.log(`Problem with reprint ${id}: ${changeArray}`);
			}else if(changedPrints[card.cardName]) {
				// reprint is legit but was added alongside a change
				// make sure the next step knows this one is fine
				changedPrints[card.cardName][id] = ["cleared"];
			}
		}
	}

	// step 7, verify reprints
	if(cli) {
		console.log("Verifying reprint changes...");
		for(let cn in changedPrints) {
			let allPrintings = printsHold[cn].allRefs;
			let changes = [];
			for(let p in allPrintings) {
				let id = allPrintings[p];
				if(changedPrints[cn][id]) {
					if(changedPrints[cn][id].length > changes.length)
						changes = changedPrints[cn][id].length;
				}else{
					console.log(`Reprint missing update: ${id}`);
				}
			}
			for(let id in changedPrints[cn]) {
				let printChanges = changedPrints[cn][id];
				let [print_exc, core_exc, shared] = toolbox.arrayDiagram(printChanges, changes);
				if(print_exc.length == 0 && core_exc.length == 0)
					continue;
				if(print_exc.length > 0 && core_exc.length > 0) {
					console.log(`Strange reprint behavior at ${id}. Missing changes ${core_exc}. Additional changes ${print_exc}.`);
				}else if(print_exc.length > 0) {
					console.log(`Excess changes at ${id}; ${print_exc}`);
				}else if(core_exc.length > 0) {
					console.log(`Missing changes at ${id}; ${core_exc}`);
				}
			}
		}
	}
	if(cli)
		console.log("Stitching complete!");
	lib.cards = finalCards;
	return lib;
}
function locateConjuredCard(cname, thisCard, cards) {
	if(thisCard.lair) {
		let cextend = ' (SL' + thisCard.lair + ')';
		if(cards.hasOwnProperty(cname+cextend+"_LAIR")) {
			cname += cextend;
		}else if(cards.hasOwnProperty(cname+cextend+"_TKN_LAIR")) {
			cname += cextend + " LAIR";
		}else if(cards.hasOwnProperty(cname+"_TKN_LAIR")) {
			cname += " LAIR";
		}
	}
	else if(cards.hasOwnProperty(cname+"_"+thisCard.setID)) {
		if(thisCard.notes.includes("reprint"))
			cname += "_" + thisCard.setID;
	}
	else if(cards.hasOwnProperty(cname+"_TKN_"+thisCard.setID)) {
		cname += " " + thisCard.setID;
	}
	else if(tag_cache[cname]) {
		let useCard = tag_cache[cname][0];
		if(tag_cache[cname].length > 1) {
			for(let c in tag_cache[came]) {
				let ccard = cards[tag_cache[cname][c]];
				if(ccard.setID != thisCard.setID)
					continue;
				useCard = tag_cache[cname][c];
				break;
			}
		}
		let setID = cards[useCard].setID;
		if(setID == "tokens")
			setID = cards[useCard].parentSet;
		cname = cards[useCard].cardName + " " + setID;
	}
	return cname;
}
function majorChange(base, comp) {
	if(!comp)
		return [];
	if(base.hasOwnProperty("cardName2") != comp.hasOwnProperty("cardName2"))
		return ["faces"];
	let errs = [];
	if(base.manaCost != comp.manaCost)
		errs.push("manaCost");
	if(base.typeLine.replace(/ $/, "") != comp.typeLine.replace(/ $/, ""))
		errs.push("type");
	if(base.power != comp.power)
		errs.push("power");
	if(base.toughness != comp.toughness)
		errs.push("toughness");
	if(base.loyalty != comp.loyalty)
		errs.push("loyalty");
	if(base.rulesText != comp.rulesText) {
		if(errs.length) {
			// probably don't need to audit this
			errs.push("rules?");
		}else{
			// wanna make super sure
			let cleanedRules = base.rulesText.replace(/ ?[*][(][^)]+[)][*]/g, "").replace(/[ \n]+$/, "").replace(/^[ \n]+/, "");
			let cleanedRules2 = comp.rulesText.replace(/ ?[*][(][^)]+[)][*]/g, "").replace(/[ \n]+$/, "").replace(/^[ \n]+/, "");
			if(cleanedRules != cleanedRules2) {
				errs.push("rules");
			}
		}
	}
	if(base.hasOwnProperty("cardName2")) {
		if(base.manaCost2 != comp.manaCost2)
			errs.push("manaCost2");
		if(base.typeLine2.replace(/ $/, "") != comp.typeLine2.replace(/ $/, ""))
			errs.push("type2");
		if(base.power2 != comp.power2)
			errs.push("power2");
		if(base.toughness2 != comp.toughness2)
			errs.push("toughness2");
		if(base.loyalty2 != comp.loyalty2)
			errs.push("loyalty2");
		if(base.rulesText2 != comp.rulesText2) {
			if(errs.length) {
				// probably don't need to audit this
				errs.push("rules?");
			}else{
				// wanna make super sure
				let cleanedRules = base.rulesText2.replace(/ ?[*][(][^)]+[)][*]/g, "").replace(/[ \n]+$/, "").replace(/^[ \n]+/, "");
				let cleanedRules2 = comp.rulesText2.replace(/ ?[*][(][^)]+[)][*]/g, "").replace(/[ \n]+$/, "").replace(/^[ \n]+/, "");
				if(cleanedRules != cleanedRules2) {
					errs.push("rules");
				}
			}
		}
	}
	return errs;
}
function arrangeColors (colorArray) {	//converts array of colors to array in mana order
	let testArray= [];
	let refArray = ["W", "U", "B", "R", "G"];
	let assembly = "";
	while(testArray.length < colorArray.length) {
		for(var i = 0; i < refArray.length; i++) {
			if(colorArray.includes(refArray[i])) {
				assembly += "1";
				testArray.push(refArray[i]);
			}else if(testArray.length != 0){
				assembly += "0";
			}
			//break after two skips, two push+skip, or skip+two push
			if(assembly.match(/(00|110|011)/)) {
				refArray.push(refArray.splice(0,1)[0]) //shift
				testArray = [];
				i=-1; //and restart
				assembly = "";
			}
		}
	}
	return testArray;
}
function pullColorIdentity(card) {
	let ci = []
	// grab from mana costs
	let mash = card.manaCost
	if(card.manaCost2)
		mash += card.manaCost2;
	let colors = mash.match(/[WUBRG]/g)
	for(let c in colors) {
		if(!ci.includes(colors[c]))
			ci.push(colors[c])
	}
	// grab from color indicators
	let conv = {"White": "W", "Blue":"U", "Black":"B", "Red":"R", "Green":"G"}
	mash = card.color
	if(card.color2)
		mash += card.color2;
	colors = mash.match(/White|Blue|Black|Red|Green/g)
	for(let cn in colors) {
		let c = conv[colors[cn]]
		if(!ci.includes(c))
			ci.push(c)
	}
	// grab from rules text
	mash = card.rulesText
	if(card.rulesText2)
		mash += " " + card.rulesText2
	mash = mash.replace(/[*][(][^)][)][*]/g, "")
	colors = mash.match(/[{][WUBRG]|[WUBRG][}]/g)
	for(let cb in colors) {
		let c = colors[cb].replace(/[{}]/, "")
		if(!ci.includes(c))
			ci.push(c)
	}
	// grab from land types
	conv = {"Plains": "W", "Island":"U", "Swamp":"B", "Mountain":"R", "Forest":"G"}
	mash = card.typeLine
	if(card.typeLine2)
		mash += card.typeLine2
	colors = mash.match(/Plains|Island|Swamp|Mountain|Forest/g)
	for(let cn in colors) {
		let c = conv[colors[cn]]
		if(!ci.includes(c))
			ci.push(c)
	}
	return ci;
}
function colorFixer(card) {						//adds colors to 3+c cards since MSE has trouble with them
	if(card.color == "" && card.manaCost.match(/\}\{/i)) {
		let colors = [];
		if(card.manaCost.match(/W/))
			colors.push("W");
		if(card.manaCost.match(/U/))
			colors.push("U");
		if(card.manaCost.match(/B/))
			colors.push("B");
		if(card.manaCost.match(/R/))
			colors.push("R");
		if(card.manaCost.match(/G/))
			colors.push("G");
		let order = arrangeColors(colors);
		if(!order.length) {
			card.colorIdentity = [];
			return;
		}
		let longs = {
			W: "White",
			U: "Blue",
			B: "Black",
			R: "Red",
			G: "Green"
		}
		let out = "{";
		for(let c in order)
			out += longs[order[c]] + "/";
		out = out.replace(/\/$/, "} ");
		card.color = out;
	}
	if(card.rulesText.match(/^This ?(creature|card|artifact|enchantment|permanent|token) is all colors./)) {
		card.color = "{White/Blue/Black/Red/Green} ";
	}else if(card.rulesText.match(/is all colors./)) {
		let newmatch = escapeRegex(card.cardName) + " is all colors.";
		if(card.rulesText.match(new RegExp(newmatch)))
			card.color = "{White/Blue/Black/Red/Green} ";
	}
	card.colorIdentity = pullColorIdentity(card)
	if(card.rulesText.match(/Vp/) || card.manaCost.match(/Vp/)) {
		// prismatic mana handling
		let pris = 0;
		let cost_syms = card.manaCost.match(/(W|U|B|R|G|Vp)/g);
		let text_blocks = card.rulesText.match(/[{][^ \n.]+[}]/g);
		let all_blocks = [];
		
		if(cost_syms && cost_syms.includes("Vp")) {
			let holder = [];
			for(let sym in cost_syms) {
				if(cost_syms[sym] == "Vp" || !holder.includes(cost_syms[sym]))
					holder.push(cost_syms[sym]);
			}
			all_blocks.push(holder);
		}
		if(text_blocks) {
			for(let b in text_blocks) {
				if(!text_blocks[b].match(/Vp/))
					continue;
				let holder = [];
				let text_syms = text_blocks[b].match(/(W|U|B|R|G|Vp)/g);
				for(let sym in text_syms) {
					if(text_syms[sym] == "Vp" || !holder.includes(text_syms[sym]))
						holder.push(text_syms[sym]);
				}
				all_blocks.push(holder);
			}
		}
		for(let o in all_blocks) {
			if(all_blocks[o].length > pris)
				pris = all_blocks[o].length;
		}
		if(pris) {
			card.pris = pris;
		}else{
			delete card.pris;
		}
	}
}
let designerOverule = {
	msem: {
		"Derelict Town": "Cajun",
		"Replicator Mage": "Korakhos",
		"Aguri, Shadow of Doubt": "HonchkrowDavid",
		"Hundred-Year Blade": "Sylph",
		"Harmony Array": "medusa",
		"Heart of Zhedina": "pkchu",
		"Polyp Pools": "Timespiraled",
		"Choked Estuary": "HerziQuerzi",
		"Foreboding Ruins": "HerziQuerzi",
		"Fortified Village": "HerziQuerzi",
		"Game Trail": "HerziQuerzi",
		"Port Town": "HerziQuerzi",
		"Imperial Barracks": "Matt",
		"Horizon of Origins": "Matt",
		"Deserted Trail": "Matt",
		"Legacy Foundations": "Matt",
		"Flourishing Waterways": "Matt",
		"Chikyu Champion": "Philippe Saner"
	}
}
function designerFixer(card, lib) {
	if(lib.name && designerOverule[lib.name] && designerOverule[lib.name][card.cardName]) {
		card.designer = designerOverule[lib.name][card.cardName];
	}else if(lib.setData[card.setID]) {
		if(!card.designer || card.designer.match(/(FT:|Story Spotlight)/i))
			card.designer = lib.setData[card.setID].Design;
	}
}
function firstPrintOverride(cardName) {
	let swaps = {
		"Endless Reverie": "Endless Reverie_ORP",
		"Terraformer's Globe": "Terraformer's Globe_ALR",
		"Nebula of Empty Gold": "Nebula of Empty Gold_LVS"
	}
	if(swaps[cardName])
		return swaps[cardName];
	return false;
}
function renderFormats(card, library) {
	let formats = [];
	let legal = library.legal;
	if(library.name == "msem") {
		if(!legal.modernBan.includes(card.cardName))
			formats.push("msem");
		if(!legal.edhBan.includes(card.cardName))
			formats.push("msedh")
	}
	else if(library.name == "revolution") {
		if(legal.banned.includes(card.cardName)) {
			//banned
		}
		else{
			//if any print is in rotation, it's legal
			let checkLegal = toolbox.arrayDuplicates(card.prints, legal.rotation);
			if(checkLegal.length) {
				formats.push("revolution")
				if(!legal.brawl.includes(card.cardName))
					formats.push("brawl")
			}
		}
		if(!legal.reveternal.includes(card.cardName))
			formats.push("reveternal")
	}
	return formats;
}

function stitchBlank(newlib, mainlib) {
	if(!newlib.cards)
		newlib = {cards:newlib}
	if(!newlib.setData)
		newlib.setData = {};
	if(!newlib.legal)
		newlib.legal = {};
	if(!mainlib) {
		mainlib = {
			cards: {},
			setData: {},
			legal: {}
		}
	}else{
		if(!mainlib.cards)
			mainlib.cards = {}
		if(!mainlib.setData)
			mainlib.setData = {};
		if(!mainlib.legal)
			mainlib.legal = {};
	}
	
	return stitchLibraries(mainlib, newlib);
}
function arrayStitch(ar) {
	let cards = arrayExpand(ar);
	return stitchBlank(cards);
}
function arrayExpand(ar) {
	if(typeof ar == "string")
		ar = require(ar);
	let cards = {};
	let sc;
	for(let c in ar) {
		if(ar[c].setID != "tokens") {
			sc = ar[c].setID;
			break;
		}
	}
	for(let c in ar) {
		let entry = ar[c];
		if(entry.skip)
			continue;
		let cn = entry.fullName;
		let tag = "_" + entry.setID;
		if(entry.setID == "tokens") {
			tag = "_TKN_" + sc;
		}
		else if(entry.rarity == "special") {
			tag = "_PRO_" + sc;
		}
		
		if(cards.hasOwnProperty(cn+tag)) {
			cn += " " + entry.cardID;
		}
		if(cards.hasOwnProperty(cn+tag)) {
			console.log("screwed entry");
			console.log(entry);
		}
		cards[cn+tag] = entry;
	}
	
	return cards;
}

if(require.main === module && process.argv[2] != undefined) {
	// CLI
	let format = process.argv[2];
	let cards = require(`./${format}/cards.json`);
	let setData = require(`./${format}/setData.json`);
	let legal = require(`./${format}/legal.json`);
	let library = {
		cards: cards,
		setData: setData,
		legal: legal
	}
	let newcards = require(`./${format}/newcards.json`);
	let newlibrary = {
		cards: newcards,
		setData: {},
		legal: {}
	}
	backupCards(format, function() {
		let finalCards = stitchLibraries(library, newlibrary).cards;
		fs.writeFile(`${format}/cards.json`, toolbox.JSONfriendly(finalCards), function(){
			console.log("cards.json written");
		})
	})
}

exports.stitchBlank = stitchBlank;
exports.stitchLibraries = stitchLibraries;
exports.arrayStitch = arrayStitch;
exports.arrayExpand = arrayExpand;
exports.conjureRegex = conjureRegex;
exports.conjureRegexG = conjureRegexG;

exports.pullColorIdentity = pullColorIdentity;
exports.arrangeColors = arrangeColors;