const fs = require('fs');
const stitch = require('./stitch.js');

var token_map = {};
var predef = [
	"Food", "Clue", "Gold", "Idol", "Treasure", "Vessel",
	"Vial", "Treasure Clue", "Bullet", "Canister", "Powerstone",
	"Plains", "Island", "Swamp", "Mountain", "Forest", "Function",
	"Scout Role", "Warlock Role", "Cleric Role", "Wizard Role", "Warrior Role",
	"Keystone", "Jelly", "Key", "Influence"
];
var fake_tokens = [
	// whenever you create ...
	"a token",
	"an artifact token",
	"an Aura token",
	"a creature token",
	"an enchantment token",
	"a noncreature token",
	//audition reminder text
	"a 1/1 Construct Actor creature token"
]
var dummied = [
	// tokens that exist but aren't used by anything, dummied out
	"Rat_TKN_GNJ",
	"Samurai_TKN_IMP",
	"Saproling_TKN_MS2",
	"Saproling_TKN_MPS_MSE",
	"Saproling_TKN_CHAMPIONS",
	"Cat Warrior_TKN_CHAMPIONS",
	"Warrior_TKN_MS1",
	"Construct_TKN_MS1",
	"Dwarf Soldier_TKN_MS1",
	"Golem_TKN_MS1",
	"Nomad_TKN_MS1",
	"Nomad_TKN_MS2",
	"Gold_TKN_MS1",
	"Black Red Goblin_TKN_SOR",
	"Spirit_TKN_ZER",
	"first strike Soldier_TKN_RVO",
	"Haste Elemental_TKN_OTH",
	"Shapeshifter_TKN_OTH",
	"Zombie_TKN_LAW"
]
var lost_tokens = {};
var claimed_tokens = {};
var unclaimed_tokens = [];
var tracker = {};

var library, sets, tknr, globalMatch, captureMatch, slimCapture, splitMatch, cidMatch

function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
// initialize regex and stuff
function initialize(lib) {
	library = lib;
	sets = Object.keys(library.setData).reverse().join("|");
	cidMatch = `^(${sets}|MSEMAR)([0-9]+)[sab]?$`;
	tknr = tokenRegex();
	globalMatch = new RegExp(tknr, 'ig');
	captureMatch = new RegExp(tknr);
	slimCapture = new RegExp(tokenRegex(true), 'i');
	splitMatch = /((?:, |, and | and | or )(?:X|a number of|that many|a|an|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) [XYZ0-9]+\/[XYZ0-9]+)/g;

	token_map = {};
	lost_tokens = {};
	claimed_tokens = {};
	unclaimed_tokens = [];
	tracker = {};
}
function tokenRegex(slim) {
	let legendName = "([A-Za-z,'-]+(,? [0-9A-Za-z,' -]+)?), ";
	let falsePositive = "[Ee]xile |[Ss]acrifice |on ";
	let tokenName_ = `(${legendName}|${falsePositive})?`
	let tokenCount = "\\b(X|X plus one|a number of|that many|a|an|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
	let tokenStatus = "( tapped| goaded)?( and attacking)?"
	let tokenSuper = "( legendary)?( basic)?( snow)? ?";
	let tokenPT = "([XYZ0-9]+\/[XYZ0-9]+ )?";
	let tokenColor = "(colorless|white|blue|black|red|green)?(, (?:white|blue|black|red|green),)?( and white| and blue| and black| and red| and green)? ?";
	let tokenSubtypes = "([A-Z][a-z]+)?( [A-Z][a-z]+)?( [A-Z][a-z]+)? ?";
	let tokenCardTypes = "(enchantment )?(artifact )?(land )?(creature )?"
	let tokenExtra = "( (with|named|that[’']s|that is|that are|attached|that can't block) [^\n.]+)?"
	
	let finalr = tokenName_ + tokenCount + tokenStatus + tokenSuper + tokenPT + tokenColor + tokenSubtypes + tokenCardTypes + "tokens?" + tokenExtra;
	if(slim) {
		finalr = tokenSuper + tokenPT + tokenColor + tokenSubtypes + tokenCardTypes + tokenExtra;
	}
	return finalr;

	//let tokenWith = "( with [^\n.]+)?";
	//let tokenNamed = "( named [^\n.]+)?";
	//let tokenMoreColors = "( (that's|that is|that are) (all colors|white, [^.]+|blue, [^.]+|black, [^.]+|red, [^.]+|green, [^.]+))?"
}
function xmlEscape(str) {
	return str.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;")
}

function countInt(count) {
	let ar = ["an", "a", "two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
	let v = ar.indexOf(count);
	if(v < 0)
		return "x";
	if(v == 0)
		return 1;
	return v;
}
function longformTokenization(str) {
	let charaMatch = str.match(/[^\n]*creates? an? (.*) token for each of the chosen characteristics[^\n]*/i);
	let basicsMatch = str.match(/Plains token, Island token, Swamp token, Mountain token, or Forest token/)
	let counterMatch = str.match(/creature counter/, "creature token");
	if(charaMatch) {
		str = str.replace(charaMatch[0], "");
		let tokenType = charaMatch[1];
		str = str.replace(/• ([^\n]+?)( with [^\n]+|\.)/g, function(match, p1, p2) {
			if(!p1 || !p2)
				return match;
			return `• Create a ${p1} ${tokenType} token${p2}`;
		})
	}
	if(basicsMatch) {
		str = str.replace(basicsMatch[0], "Plains token, or create an Island token, or create a Swamp token, or create a Mountain token, or create a Forest token");
	}
	if(counterMatch)
		str = str.replace(/([^ ]+ [0-9X]+\/[0-9X]+ [^.]+) creature counter/g, "create $1 creature token");
	return str;
}
function tokenPuller(c, shout) {
	// BIG BAD CREATE TOKENS SCRIPT
	let thisCard = library.cards[c];
	let oracle = thisCard.rulesText
	if(thisCard.rulesText2)
		oracle += "\n" + thisCard.rulesText2;
	oracle = longformTokenization(oracle);
	let cleanoracle = oracle.replace(new RegExp(escapeRegex(thisCard.cardName), 'i'), "~")
	if(thisCard.cardName2)
		cleanoracle = cleanoracle.replace(new RegExp(escapeRegex(thisCard.cardName2), 'i'), "~")
	

	let bigMatch = oracle.match(/creates? [^.]+/ig);
	let tokens = [];
	if(bigMatch) {
		for(let m in bigMatch) {
			let tokenLine = bigMatch[m].replace(/^creates? /i, "");
			let groups = tokenLine.match(globalMatch);
			let temp = [];
			for(let g in groups) {
				if(groups[g].match(splitMatch)) {
					// this is multiple tokens that looks like one
					let splitten = groups[g].split(splitMatch);
					groups[g] = splitten[0];
					for(let j=1; j<splitten.length; j+=2) {
						groups.push(splitten[j]+splitten[j+1]);
					}
				}
			}
			for(let g in groups) {
				if(fake_tokens.includes(groups[g]))
					continue;
				if(groups[g].match(/a copy/))
					continue;
				let waycheck = groups[g].match(/a colorless land token that's an? (Plains|Island|Swamp|Mountain|Forest|Desert) and the chosen basic land type/);
				if(waycheck) {
					let add = [];
					switch(waycheck[1]) {
						case "Plains":
							add = ["Plains Island", "Plains Swamp", "Mountain Plains", "Forest Plains"];
							break;
						case "Island":
							add = ["Plains Island", "Island Swamp", "Island Mountain", "Forest Island"];
							break;
						case "Swamp":
							add = ["Plains Swamp", "Island Swamp", "Swamp Mountain", "Swamp Forest"];
							break;
						case "Mountain":
							add = ["Mountain Plains", "Island Mountain", "Swamp Mountain", "Mountain Forest"];
							break;
						case "Forest":
							add = ["Forest Plains", "Forest Island", "Swamp Forest", "Mountain Forest"];
							break;
						case "Desert":
							add = ["Desert Plains", "Desert Island", "Desert Swamp", "Desert Mountain", "Desert Forest"];
							break;
					}
					for(let a in add)
						tokens.push(["colorless " + add[a] + " land", 1]);
					continue;
				}
				groups[g] = groups[g].replace(/(, (where|except|then).*)/g, "");
				let tokenMatch = groups[g].match(captureMatch);
				//console.log(tokenMatch);//yeet
				if(tokenMatch) {
					temp.push(tokenMatch);
					let legendName_ = tokenMatch[2];
					let tokenCount = tokenMatch[4];
					let tN = countInt(tokenCount);
					let tokenTapped_ = tokenMatch[5];
					let tokenAttacking_ = tokenMatch[6];
					let tokenLegendary_ = tokenMatch[7];
					let tokenBasic_ = tokenMatch[8];
					let tokenSnow_ = tokenMatch[9];
					let tokenPT = tokenMatch[10];
					let tokenColor1 = tokenMatch[11];
					let tokenColorMid = tokenMatch[12];
					let tokenColor2 = tokenMatch[13];
					let tokenSubType1 = tokenMatch[14];
					let tokenSubType2 = tokenMatch[15];
					let tokenSubType3 = tokenMatch[16];
					let tokenEnchantment_ = tokenMatch[17];
					let tokenArtifact_ = tokenMatch[18];
					let tokenLand_ = tokenMatch[19];
					let tokenCreature_ = tokenMatch[20];
					let tokenExtra = tokenMatch[21];

					let falsep = ["Exile ", "exile ", "Sacrifice ", "sacrifice ", "on "];
					if(falsep.includes(legendName_))
						legendName_ = false;
					let tokenWith, tokenNamed, tokenExtraColors;
					if(tokenExtra) {
						let bits = tokenExtra.split(/(with|named|that's|that is|that are|attached|and has|that can't block)/);
						let opts = ["with","named","that's","that is","that are","that’s","and has", "that can't block"];
						for(let i=0; i<bits.length; i++) {
							if(opts.includes(bits[i])) {
								if(bits[i] == "with" || bits[i] == "and has" || bits[i] == "that can't block") {
									tokenWith = "with some other stuff";
									let test = "with" + bits[i+1];
									// pt define
									if(test.match(/with (power|toughness)/) && (!tokenPT || tokenPT.match("X")))
										tokenWith = null;
									// counters
									if(test.match(/with [^ ] [+-]/))
										tokenWith = null;
									// tokens often don't list haste
									if(test.match(/with haste ?$/))
										tokenWith = null;
									i++;
								}else if(bits[i] == "named") {
									tokenNamed = bits[i+1].replace(/^ | $/g, "");
									i++;
								}else if(bits[i+1].match(/ (all|white|blue|black|red|green)/)){
									tokenExtraColors = bits[i] + bits[i+1];
									i++;
								}
							}
						}
					}
					if(legendName_) {
						// explicit legend name
						tokens.push([legendName_, tN]);
						continue;
					}else if(tokenNamed) {
						// explicit given name
						tokens.push([tokenNamed, tN]);
						continue;
					}else{
						// resolve sub types
						let tokenSubTypes = "";
						if(tokenSubType1)
							tokenSubTypes += tokenSubType1;
						if(tokenSubType2)
							tokenSubTypes += tokenSubType2;
						if(tokenSubType3)
							tokenSubTypes += tokenSubType3;
						tokenSubTypes = tokenSubTypes.replace(/ $/, "");
						if(predef.includes(tokenSubTypes)) {
							tokens.push([tokenSubTypes, tN]);
							continue;
						}
						// resolve card types
						let tokenCardTypes = "";
						if(tokenEnchantment_)
							tokenCardTypes += tokenEnchantment_;
						if(tokenArtifact_)
							tokenCardTypes += tokenArtifact_;
						if(tokenLand_)
							tokenCardTypes += tokenLand_;
						if(tokenCreature_) {
							tokenCardTypes += tokenCreature_;
							if(!tokenPT || tokenPT == " ")
								tokenPT = "X/X";
						}
						
						// resolve color
						let tokenColorA = arrangeTokenColors([tokenColor1, tokenColorMid, tokenColor2]);
						
						let pieces = [];
						if(tokenPT) {
							tokenPT.replace(/ /g, "");
							pieces.push(tokenPT);
						}
						if(tokenColorA)
							pieces.push(tokenColorA);
						if(tokenSubTypes)
							pieces.push(tokenSubTypes);
						if(tokenCardTypes)
							pieces.push(tokenCardTypes.replace(/ $/, ""));
						if(tokenExtraColors)
							pieces.push(tokenExtraColors);
						
						let token_base_name = pieces.join(" ");
						if(tokenWith) {
							token_base_name += " with some other stuff";
						}
						token_base_name = token_base_name.replace(/  /g, " ").replace(/that are/, "that's");
						if(token_base_name.match(/a copy/))
							token_base_name = "";
						if(token_base_name == "of those")
							token_base_name = "";
						token_base_name = token_base_name.replace(/(^ +| +$)/g, "").replace(/that is all/, "that's all");
						let token_with_name = token_base_name.replace(" with some other stuff", "");
						if(tokenExtra)
							token_with_name += tokenExtra;
						if(token_base_name)
							tokens.push([token_base_name, tN, token_with_name]);
					}
				}
			}
			// manual corrections
			for(let t in tokens) {
				switch(tokens[t][0]) {
					case "Masterpiece":
						tokens[t][0] = "Thrice-Folded Lotus";
						tokens.push(["Mirror of Possibilities", tokens[t][1]], "Masterpiece");
						tokens.push(["Cultivating Spheres", tokens[t][1]], "Masterpiece");
						break;
					case "colorless land":
						tokens[t][0] = "colorless Plains Island land";
						tokens.push(["colorless Island Swamp land", tokens[t][1]]);
						tokens.push(["colorless Swamp Mountain land", tokens[t][1]]);
						tokens.push(["colorless Mountain Forest land", tokens[t][1]]);
						tokens.push(["colorless Forest Plains land", tokens[t][1]]);
						tokens.push(["colorless Plains Swamp land", tokens[t][1]]);
						tokens.push(["colorless Island Mountain land", tokens[t][1]]);
						tokens.push(["colorless Swamp Forest land", tokens[t][1]]);
						tokens.push(["colorless Mountain Plains land", tokens[t][1]]);
						tokens.push(["colorless Forest Island land", tokens[t][1]]);
						break;
				}
			}
		}
	}
	
	// EMBLEMS
	if(thisCard.rulesText.match(/ an emblem /)) {
		if(thisCard.typeLine.match(/Planeswalker/)) {
			let subtype = thisCard.typeLine.replace(/[^—]+ — /, "").replace(/ +$/, "");
			if(subtype == "Legendary Planeswalker")
				subtype = "Forgotten";
			tokens.push([subtype + " Emblem", 1, "an emblem"]);
		}else{
			tokens.push([thisCard.cardName + " Emblem", 1, "an emblem"]);
		}
	}
	if(thisCard.rulesText2 && thisCard.rulesText2.match(/ an emblem /)) {
		if(thisCard.typeLine2.match(/Planeswalker/)) {
			let subtype = thisCard.typeLine2.replace(/[^—]+ — /, "").replace(/ +$/, "");
			if(!subtype)
				subtype = "Forgotten";
			tokens.push([subtype + " Emblem", 1, "an emblem"])
		}else{
			tokens.push([thisCard.cardName2 + " Emblem", 1, "an emblem"]);
		}
	}
	
	// AUDITION
	let auditionMatch = thisCard.rulesText.match(/audition for (white|blue|black|red|green)/i)
	let auditionMatch2 = thisCard.rulesText.match(/audition for (white|blue|black|red|green) or for (white|blue|black|red|green)/i)
	if(auditionMatch) {
		tokens.push(["1/1 colorless Construct Actor creature", 1]);
		switch(auditionMatch[1]) {
			case "white":
				tokens.push(["Cleric Role", 1]);
				tokens.push(["Scout Role", 1]);
				break;
			case "blue":
				tokens.push(["Warlock Role", 1]);
				tokens.push(["Wizard Role", 1]);
				break;
			case "black":
				tokens.push(["Cleric Role", 1]);
				tokens.push(["Warlock Role", 1]);
				break;
			case "red":
				tokens.push(["Warrior Role", 1]);
				tokens.push(["Wizard Role", 1]);
				break;
			case "green":
				tokens.push(["Scout Role", 1]);
				tokens.push(["Warrior Role", 1]);
				break;
		}
	}
	if(auditionMatch2) {
		switch(auditionMatch[2]) {
			case "white":
				tokens.push(["Cleric Role", 1]);
				tokens.push(["Scout Role", 1]);
				break;
			case "blue":
				tokens.push(["Warlock Role", 1]);
				tokens.push(["Wizard Role", 1]);
				break;
			case "black":
				tokens.push(["Cleric Role", 1]);
				tokens.push(["Warlock Role", 1]);
				break;
			case "red":
				tokens.push(["Warrior Role", 1]);
				tokens.push(["Wizard Role", 1]);
				break;
			case "green":
				tokens.push(["Scout Role", 1]);
				tokens.push(["Warrior Role", 1]);
				break;
		}
	}
	// MSEMAR
	if(oracle.match(/(that's a copy|that is a copy|that are copies|Copy target (permanent )?spell)/)) {
		tokens.push(["Copy", 1, "MSEMAR"]);
	}
	if(oracle.match(/(play|cast) ([^\n.]+ (from exile|exiled)|(one of )?those cards|them|it this turn|it until)/)) {
		tokens.push(["Can Be Cast From Exile", 1, "MSEMAR"]);
	}
	if(cleanoracle.match(/journey/i))
		tokens.push(["Journey", 1, "Keyword: Journey"]);
	if(cleanoracle.match(/eureka!/i))
		tokens.push(["Research Counter", 1, "Keyword: Eureka!"]);
	if(cleanoracle.match(/the monarch/i))
		tokens.push(["The Monarch", 1, "Keyword: The Monarch"]);
	if(cleanoracle.match(/shimmer/i))
		tokens.push(["Shimmer", 1, "Keyword: Shimmer"]);
	if(cleanoracle.match(/substantiate/i))
		tokens.push(["Substantiate", 1, "Keyword: Substantiate"]);
	if(cleanoracle.match(/submerge/i))
		tokens.push(["Submerge", 1, "Keyword: Submerge"]);
	if(cleanoracle.match(/(meta|mega)?morph/i))
		tokens.push(["Morph", 1, "Keyword: Morph"]);
	if(cleanoracle.match(/manifest/i))
		tokens.push(["Manifest", 1, "Keyword: Manifest"]);
	if(cleanoracle.match(/foretell/i))
		tokens.push(["Foretell", 1, "Keyword: Foretell"]);
	if(cleanoracle.match(/glory counter/i))
		tokens.push(["Glory Counter", 1, "Keyword: Glory Counters"]);
	if(cleanoracle.match(/Primal/i))
		tokens.push(["Primal", 1, "Keyword: Primal"]);
	if(cleanoracle.match(/Tunneler/i)) {
		tokens.push(["The Tunnels", 1, "Keyword: Tunneler"]);
		tokens.push(["Tunnel Divider", 1, "Keyword: Tunneler"]);
	}
	if(cleanoracle.match(/archive|codex|additional (face-up )?library/i))
		tokens.push(["Additional Library", 1, "Keyword: Additional Library"]);
	if(thisCard.typeLine2 && thisCard.typeLine2.match(/Adventure/))
		tokens.push(["On an Adventure", 1, "Keyword: Adventure"]);
	if(cleanoracle.match(/^(Revive|Successor)(—| \{)/m))
		tokens.push([thisCard.cardName, 1, "Keyword: Revive"]);
	if(cleanoracle.match(/^Compose/m))
		tokens.push(["colorless Saga enchantment with some other stuff", 1, "Keyword: Compose"]);
	
	// field test
	if(cleanoracle.match(/Embrace/i)) {
		tokens.push(["Embraced Cards", 1, "Keyword: Embrace"]);
		tokens.push(["Embraced Representative", 1, "Keyword: Embrace"]);
	}
	if(cleanoracle.match(/equalise [^.,]+ X times/i)) {
		tokens.push(["Equalised Dragon", "x", "Keyword: Equalise"]);
	}else if(cleanoracle.match(/equalise/i)) {
		tokens.push(["Equalised Dragon", 1, "Keyword: Equalise"]);
	}
	if(cleanoracle.match(/^Aurora/)) {
		tokens.push(["Aurora Reminder", 1, "Keyword: Aurora"]);
	}
	if(cleanoracle.match(/builds? hype/)) {
		tokens.push(["3/2 red Fan creature", 1, "Keyword: build hype"]);
	}
	if(cleanoracle.match(/magnetize/i)) {
		tokens.push(["1/1 colorless Servo artifact creature", 1, {source:"Keyword: magnetize"}]);
	}
	if(cleanoracle.match(/network/i)) {
		tokens.push(["Favors", 1, "Keyword: Favor"])
	}
	if(cleanoracle.match(/Subroutine/) || thisCard.typeLine.match(/Subroutine/)) {
		tokens.push(["ProgramA", 1]);
		tokens.push(["ProgramB", 1]);
		tokens.push(["ProgramC", 1]);
	}
	if(cleanoracle.match(/call the beast/i)) {
		tokens.push(["Call The Beast Emblem", 1]);
		tokens.push(["The Beast", 1]);
	}
	if(cleanoracle.match(/^Ascend/) && !cleanoracle.match(/^Ascend [{]/)) {
		tokens.push(["The City's Blessing", 1]);
	}
	if(cleanoracle.match(/^Sunken/) || cleanoracle.match(/Trench/)) {
		tokens.push(["colorless Trench land with some other stuff", 1, "Keyword: Sunken"]);
	}

	// apply tokenscripts overrides
	if(thisCard.tokenscripts) {
		let ts = thisCard.tokenscripts;
		if(ts.r) {
			tokens = ts.r;
		}
		if(ts.a) {
			for(let t in ts.a) {
				tokens.push(ts.a[t]);
			}
		}
	}
	// connect to tokens

	for(let t in tokens) {
		let tn = tokens[t][0].replace(/(^ +| +$)/g, "");
		let tc = tokens[t][1];
		let tm = tokens[t][2];
		if(shout)
			console.log(tn);
		// check if we missed the word creature
		if(!token_map[tn]) {
			if(tn.match(/[X0-9]+\/[X0-9]+/) && !tn.match(/creature/)) {
				let test;
				if(tn.match("with some other stuff")) {
					test = tn.replace("with some other stuff", "creature with some other stuff");
				}else{
					test = tn + " creature";
				}
				if(token_map[test])
					tn = test;
				
			}
		}
		// check if we saw an ability that wasn't real
		if(!token_map[tn]) {
			let test = tn.replace(" with some other stuff", "");
			if(token_map[test])
				tn = test;
		}
		// see if we have a variable size token we can use
		if(!token_map[tn]) {
			let test = tn.replace(/[0-9X]+\/[0-9X]+/, "X/X");
			if(token_map[test])
				tn = test;
		}
		// see if this is an alternate emblem name
		if(!token_map[tn] && tm == "an emblem") {
			let test = thisCard.cardName + " Emblem";
			if(token_map[test]) {
				tn = test;
			}
		}
		if(!token_map[tn]) {
			if(tm != "MSEMAR") {
				if(!lost_tokens[tn])
					lost_tokens[tn] = {}
				if(!lost_tokens[tn][c])
					lost_tokens[tn][c] = (tm || tn);
			}
		}else{
			let slot;
			if(thisCard.setID == "LAIR" && thisCard.hidden) {
				let sltag = thisCard.hidden.match(/[(](SL[0-9]+)[)]/);
				if(sltag)
					slot = token_map[tn][sltag[1]];
			}
			if(!slot)
				slot = token_map[tn][thisCard.setID];
			if(!slot)
				slot = token_map[tn].MSEMAR;
			if(!slot)
				slot = token_map[tn][Object.keys(token_map[tn])[0]];
			// TODO, specification
			let tokenID = slot[0];
			if(shout)
				console.log(tokenID);
			if(!claimed_tokens[tokenID])
				claimed_tokens[tokenID] = {};
			if(!claimed_tokens[tokenID][c])
				claimed_tokens[tokenID][c] = [];
			claimed_tokens[tokenID][c].push(tokens[t][1])
		}
	}
	return tokens;
}

function tokenBuilding(flags) {
	if(!flags)
		flags = {};
	let broken_tokens = [];
	let broken_conjure = [];
	let with_spellbooks = [];
	// first look for new predefined tokens
	for(let c in library.cards) {
		if(library.cards[c].setID == "tokens")
			continue;
		let card = library.cards[c];
		let prede_check = card.rulesText.match(/[Cc]reate (?:an|a|X|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) ([A-Z][a-z]+([- ][A-Z][a-z]+)?) tokens?/);
		if(prede_check) {
			let prede = prede_check[1];
			if(!predef.includes(prede)) {
				//console.log(`Found predefined token "${prede}"`);
				predef.push(prede);
			}
			
		}
	}
	// then loop tokens
	for(let c in library.cards) {
		if(library.cards[c].setID != "tokens")
			continue;
		// grab setID
		let originSet = library.cards[c].parentSet || "BOT";
		let altSet = "";
		let sltag = library.cards[c].fullName.match((/[(](SL[0-9]+)[)]/));
		if(sltag) {
			altSet = sltag[1];
		}
		let tokenName = tokenNamer(library.cards[c]);
		if(!token_map[tokenName])
			token_map[tokenName] = {}
		if(!token_map[tokenName][originSet])
			token_map[tokenName][originSet] = [];
		token_map[tokenName][originSet].push(c);
		let tokenNames = tokenAliases(library.cards[c]);
		for(let n in tokenNames) {
			let tokenName = tokenNames[n];
			if(!token_map[tokenName])
				token_map[tokenName] = {}
			if(!token_map[tokenName][originSet])
				token_map[tokenName][originSet] = [];
			if(!token_map[tokenName][originSet].includes(c))
				token_map[tokenName][originSet].push(c);
			if(altSet) {
				if(!token_map[tokenName][altSet])
					token_map[tokenName][altSet] = [];
				if(!token_map[tokenName][altSet].includes(c))
					token_map[tokenName][altSet].push(c);
			}
		}
	}
	
	// loop cards to find the tokens they want
	for(let c in library.cards) {
		let tokens = tokenPuller(c);
		if(tokens.length == 0) {
			if(library.cards[c].rulesText.match(/(?<!(When(ever)? (you|a player|an opponent) |If you would )[^,]*)\bcreates? (?![^ ]+ tokens? (that's|that is|that are) (a copy|copies))/i))
				broken_tokens.push(c);
		}
		if(library.cards[c].spellbook.length) {
			with_spellbooks.push(c);
		}
		else if(library.cards[c].rulesText.match(/conjure/)) {
			broken_conjure.push(c);
		}
	}
	
	//console.log("UNUSED TOKENS")
	for(let n in token_map) {
		for(let s in token_map[n]) {
			for(let id in token_map[n][s]) {
				if(!claimed_tokens[token_map[n][s][id]]) {
					if(dummied.includes(token_map[n][s][id]))
						continue;
					if(unclaimed_tokens.includes(token_map[n][s][id]))
						continue;
					unclaimed_tokens.push(token_map[n][s][id])
				}
			}
		}
	}
	if(flags.writeTokens) {
		writeTokensFile(flags.writeTokens);
	}

	let resp = "";
	if(flags.reportTokens) {
		let chunks = [];
		if(unclaimed_tokens.length) {
			let piece = "The following tokens are unused:";
			for(let i in unclaimed_tokens) {
				let id = unclaimed_tokens[i];
				let tn = tokenNamer(library.cards[id]);
				piece += `\n${tn} (${library.cards[id].cardID})`;
			}
			chunks.push(piece);
		}else{
			chunks.push("All tokens are used.");
		}
		let lc = {};
		for(let l in lost_tokens) {
			for(let c in lost_tokens[l]) {
				if(!lc[lost_tokens[l][c]])
					lc[lost_tokens[l][c]] = [];
				lc[lost_tokens[l][c]].push(c);
			}
		}
		let lost = "";
		for(let l in lc) {
			lost += `\n${l} (`
			for(let c in lc[l]) {
				lost += library.cards[lc[l][c]].cardName + ";";
			}
			lost = lost.replace(/;$/, ")")
		}
		if(lost) {
			lost = "These tokens are created by cards, but do not have a token." + lost;
		}else{
			lost = "All created tokens are accounted for."
		}
		chunks.push(lost);
		if(broken_tokens.length) {
			let piece = "The following cards might create tokens, but were unable to be processed:\n";
			piece += broken_tokens.join("\n");
			chunks.push(piece);
		}else{
			chunks.push("No malformed tokens found.");
		}
		if(broken_conjure.length) {
			let piece = "\nThe following cards appear to conjure cards, but weren't linked to any:\n";
			piece += broken_conjure.join("\n");
			chunks.push(piece);
		}
		let asg = "\n\nASSIGNED TOKENS\n";
		for(let t in claimed_tokens) {
			let tn = tokenNamer(library.cards[t]);
			tn += ` (${library.cards[t].cardID})`;
			asg += tn + "\n";
			for(let id in claimed_tokens[t]) {
				let card = library.cards[id];
				asg += `${card.cardName} (${claimed_tokens[t][id].join(",")})\n`;
			}
			asg += "\n";
		}
		chunks.push(asg);
		
		if(with_spellbooks.length) {
			let piece = "\n\nASSIGNED CONJURES\n";
			for(let i in with_spellbooks) {
				let card = library.cards[with_spellbooks[i]];
				let sb = {};
				for(let c in card.spellbook) {
					if(!sb[card.spellbook[c]])
						sb[card.spellbook[c]] = 0;
					sb[card.spellbook[c]]++;
				}
				piece += card.cardName + ": ";
				for(let k in sb) {
					piece += `${k} (x${sb[k]}); `;
				}
				piece += "\n";
				// remove this from unused tokens
			}
			chunks.push(piece);
		}
		
		resp = chunks.join("\n\n");
	}
	return resp;
}
function cardBuilding(flags) {
	if(!flags)
		flags = {};
	let str = `<?xml version="1.0" encoding="UTF-8"?>
<cockatrice_carddatabase version="4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://raw.githubusercontent.com/Cockatrice/Cockatrice/master/doc/carddatabase_v4/cards.xsd">`;

	str += "\r\n\t<sets>\r\n";
	for(let s in library.setData) {
		str += "\t\t<set>\r\n";
		str += `\t\t\t<name>${s}</name>\r\n`;
		str += `\t\t\t<longname>${library.setData[s].longname}</longname>\r\n`;
		str += `\t\t\t<settype>${library.setData[s].pool}</settype>\r\n`;
		str += `\t\t\t<releasedate>${library.setData[s].releaseDate}</releasedate>\r\n`;
		str += "\t\t</set>\r\n";
	}
	str += "\t</sets>\r\n";
	
	str += "\t<cards>\r\n";
	for(let c in library.cards) {
		let card = library.cards[c];
		if(card.setID == "tokens")
			continue;
		str += writeCardBlock(c);
	}
	str += "\t</cards>\r\n";
	
	str += "</cockatrice_carddatabase>";
	
	if(flags.writeCards) {
		fs.writeFile(flags.writeCards, str.replace(/’/g, "'"), (err) => {
			if(err)
				throw err;
			console.log("Cards XML written");
		})
	}
}
function claimAToken(tn, cn, tc) {
	if(tc == 0)
		return;
	if(!claimed_tokens[tn])
		claimed_tokens[tn] = {};
	if(!claimed_tokens[tn][cn])
		claimed_tokens[tn][cn] = [];
	claimed_tokens[tn][cn].push(tc);
}
function writeTokensFile(dest) {
	let contents = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<cockatrice_carddatabase version=\"3\">\r\n<cards>\r\n";
	for(let token_key in claimed_tokens) {
		contents += writeTokenBlock(token_key)
	}
	for(let e in unclaimed_tokens) {
		contents += writeTokenBlock(unclaimed_tokens[e])
	}
	contents += "</cards>\r\n</cockatrice_carddatabase>";
	fs.writeFile(dest, contents.replace(/’/g, "'"), (err) => {
		if (err) throw err;
		console.log("Tokens XML written");
	});
}
function keysToNames() {
	let output = {};
	for(let n in tracker) {
		if(!output[tracker[n]])
			output[tracker[n]] = [];
		output[tracker[n]].push(n);
	}
	return output;
}
function linkTokenNames() {
	let output = {};
	for(let c in library.cards) {
		let card = library.cards[c];
		if(card.setID != "tokens")
			continue;
		let token_core = tokenNamerSimple(card);
		let token_set = pullTokenSet(card, library.setData)
		let ticker = 2;
		if(tracker[token_core] && !token_core.match(token_set)) {
			// we used this name already but we can add a set code maybe
			token_core += " " + token_set;
		}
		let token_name = "" + token_core;
		while(tracker[token_name]) {
			// we used this name, add a number
			token_name = token_core + " " + ticker;
			ticker++;
		}
		tracker[token_name] = true;
		output[c] = token_name;
	}
	return output;
}
function writeCardBlock(key) {
	let card = library.cards[key];
	if(!card)
		return;
	let cardNames = sourceNames(card);
	for(let n in cardNames) {
		if(cardNames[n] == "")
			continue;
		let runner = 2;
		let main_name = cardNames[n];
		let test_name = main_name;
		while(tracker[test_name]) {
			test_name = `${main_name} (${runner})`
			runner++;
		}
		tracker[test_name] = key;
	}
		
	let mt = mainType(card.typeLine);

	let contents = "";
	contents += "\t\t<card>\r\n";
	contents += "\t\t\t<name>" + xmlEscape(cardNames[0]) + "</name>\r\n";
	contents += "\t\t\t<text>" + xmlEscape(formatTriceText(card)) + "</text>\r\n";
	contents += "\t\t\t<prop>\r\n";
	contents += "\t\t\t\t<side>front</side>\r\n";
	contents += "\t\t\t\t<manacost>" + card.manaCost.replace(/[{}]/g,"") + "</manacost>\r\n";
	contents += "\t\t\t\t<cmc>" + card.cmc + "</cmc>\r\n";
	contents += "\t\t\t\t<colors>" + colorTranslate(card.color) + "</colors>\r\n";
	contents += "\t\t\t\t<coloridentity>" + card.colorIdentity.join("") + "</coloridentity>\r\n";
	contents += "\t\t\t\t<layout>" + convertLayout(card.shape) + "</layout>\r\n";
	contents += "\t\t\t\t<type>" + xmlEscape(trim(card.typeLine)) + "</type>\r\n";
	contents += "\t\t\t\t<maintype>" + mt + "</maintype>\r\n";
	if(card.power)
		contents += "\t\t\t\t<pt>" + card.power + "/" + card.toughness + "</pt>\r\n";
	if(card.loyalty)
		contents += "\t\t\t\t<loyalty>" + card.loyalty + "</loyalty>\r\n";
	if(card.defense)
		contents += "\t\t\t\t<defense>" + card.defense + "</defense>\r\n";
	if(library.setData[card.setID] && library.setData[card.setID].pool) {
		let trimmed = library.setData[card.setID].pool.replace(/ Pool/i, "").toLowerCase()
		contents += "\t\t\t\t<format-" + trimmed + ">legal</format-" + trimmed + ">\r\n";
	}
	contents += "\t\t\t</prop>\r\n";
	contents += "\t\t\t<tablerow>"
	if(mt == "Land") {
		contents += "0";
	}else if(mt == "Creature") {
		contents += "2";
	}else if(mt == "Instant" || mt == "Sorcery") {
		contents += "3";
	}else{
		contents += "1";
	}
	contents += "</tablerow>\r\n";
	if(card.rulesText.match(escapeRegex(card.cardName) + " enters the battlefield tapped"))
		contents += "\t\t\t<cipt>1</cipt>\r\n";
	if(card.rulesText.match(escapeRegex(card.cardName) + " enters tapped"))
		contents += "\t\t\t<cipt>1</cipt>\r\n";
	if(cardNames[1])
		contents += `\t\t\t<related attach="transform">${xmlEscape(cardNames[1])}</related>\r\n`;
	for(let s in card.spellbook) {
		contents += `\t\t\t<related persistent="persistent">${xmlEscape(card.spellbook[s])}</related>\r\n`;
	}
	contents += `\t\t\t<set num="${card.cardID}${(card.shape == "doubleface" ? "a" : "")}"`;
	contents +=	` rarity="${card.rarity}"`;
	if(card.scryID)
		contents += ` uuid="${card.scryID}"`;
	contents += `>${card.setID}</set>\r\n`;
	contents += "\t\t</card>\r\n";
	if(cardNames[2])
		contents = contents + contents.replace(cardNames[0], cardNames[2]).replace(cardNames[1], cardNames[3]);
	
	if(cardNames[1]) {
		let mt2 = mainType(card.typeLine2);
		let contents2 = "";
		contents2 += "\t\t<card>\r\n";
		contents2 += "\t\t\t<name>" + xmlEscape(cardNames[1]) + "</name>\r\n";
		contents2 += "\t\t\t<text>" + xmlEscape(formatTriceText(card, true)) + "</text>\r\n";
		contents2 += "\t\t\t<prop>\r\n";
		contents2 += "\t\t\t\t<side>back</side>\r\n";
		contents2 += "\t\t\t\t<manacost>" + card.manaCost2.replace(/[{}]/g,"") + "</manacost>\r\n";
		contents2 += "\t\t\t\t<cmc>" + card.cmc2 + "</cmc>\r\n";
		contents2 += "\t\t\t\t<colors>" + colorTranslate(card.color2) + "</colors>\r\n";
		contents2 += "\t\t\t\t<coloridentity>" + card.colorIdentity.join("") + "</coloridentity>\r\n";
		contents2 += "\t\t\t\t<layout>" + convertLayout(card.shape) + "</layout>\r\n";
		contents2 += "\t\t\t\t<type>" + xmlEscape(trim(card.typeLine2)) + "</type>\r\n";
		contents2 += "\t\t\t\t<maintype>" + mt2 + "</maintype>\r\n";
		if(card.power2)
			contents2 += "\t\t\t\t<pt>" + card.power2 + "/" + card.toughness2 + "</pt>\r\n";
		if(card.loyalty2)
			contents2 += "\t\t\t\t<loyalty>" + card.loyalty2 + "</loyalty>\r\n";
		if(card.defense2)
			contents2 += "\t\t\t\t<defense>" + card.defense2 + "</defense>\r\n";
		contents2 += "\t\t\t</prop>\r\n";
		contents2 += "\t\t\t<tablerow>"
		if(mt2 == "Land") {
			contents2 += "0";
		}else if(mt2 == "Creature") {
			contents2 += "2";
		}else if(mt2 == "Instant" || mt2 == "Sorcery") {
			contents2 += "3";
		}else{
			contents2 += "1";
		}
		contents2 += "</tablerow>\r\n";
		if(card.rulesText2.match(escapeRegex(card.cardName2) + " enters the battlefield tapped"))
			contents2 += "\t\t\t<cipt>1</cipt>\r\n";
		if(card.rulesText2.match(escapeRegex(card.cardName2) + " enters tapped"))
			contents2 += "\t\t\t<cipt>1</cipt>\r\n";
		contents2 += `\t\t\t<related attach="transform">${xmlEscape(cardNames[0])}</related>\r\n`;
		for(let s in card.spellbook) {
			contents2 += `\t\t\t<related persistent="persistent">${xmlEscape(card.spellbook[s])}</related>\r\n`;
		}
		contents2 += `\t\t\t<set num="${card.cardID}b" rarity="${card.rarity}"`;
		if(card.scryID)
			contents2 += ` uuid="${card.scryID}"`;
		contents2 += `>${card.setID}</set>\r\n`;
		contents2 += "\t\t</card>\r\n";
		if(cardNames[3])
			contents2 = contents2 + contents2.replace(xmlEscape(cardNames[0]), xmlEscape(cardNames[2])).replace(xmlEscape(cardNames[1]), xmlEscape(cardNames[3]));
		
		contents += contents2;
	}
	return contents;
}
function trim(str) {
	return str.replace(/(^ +| +$)/g, "");
}
function formatTriceText(card, just_back) {
	let str = card.rulesText;
	if(just_back) {
		str = card.rulesText2;
	}else if(card.rulesText2 && card.shape != "doubleface") {
		str += "\n---\n";
		if(card.shape == "adventure") {
			str += card.cardName2 + " " + card.manaCost2 + "\n";
			str += card.typeLine2 + "\n" + card.rulesText2;
		}else{
			str += card.rulesText2;
		}
	}
	if(card.shape == "doubleface") {
		str += "\n---\n";
		if(just_back) {
			str += "Transforms from " + card.cardName;
		}else{
			str += "Transforms into " + card.cardName2;
		}
	}
	return str.replace(/[*]/g, "");
}
function mainType(str, sh) {
	if(str.match(/Land/))
		return "Land";
	if(str.match(/Creature/))
		return "Creature";
	if(str.match(/Planeswalker/))
		return "Planeswalker";
	let types = str.match(/(Artifact|Enchantment|Instant|Sorcery|Battle|Dungeon|Conspiracy|Plane|Vanguard)/g);
	if(types)
		return types[0];
	return "";
}
function convertLayout(str) {
	let res = "normal";
	switch(str) {
		case "doubleface":
			res = "transform";
			break;
		case "split":
		case "aftermath":
			res = "split";
			break;
			
	}
	return res;
}
function writeTokenBlock(key) {
	if(!library.cards[key])
		return "";
	let contents = "";
	let card = library.cards[key];
	let card_sources = claimed_tokens[key];
	if(!card_sources)
		card_sources = [];
	contents += "<card>\r\n";
	
	let token_core = tokenNamerSimple(card);
	let token_set = pullTokenSet(card, library.setData)
	let ticker = 2;
	if(tracker.hasOwnProperty(token_core) && !token_core.match(token_set)) {
		// we used this name already but we can add a set code maybe
		token_core += " " + token_set;
	}
	let token_name = "" + token_core;
	while(tracker.hasOwnProperty(token_name)) {
		// we used this name, add a number
		token_name = token_core + " " + ticker;
		ticker++;
	}
	tracker[token_name] = key;
	contents += " <name>"+xmlEscape(token_name)+"</name>\r\n";

	let cardColors = colorTranslate(card.color);
	for(let i=0;i<cardColors.length;i++) {
		contents += " <color>"+cardColors.charAt(i)+"</color>\r\n";
	}
	contents += " <manacost>"+card.manaCost.replace(/[{}]/g,"")+"</manacost>\r\n";
	contents += " <cmc>"+card.cmc+"</cmc>\r\n";
	if(card.loyalty)
		contents += " <loyalty>"+card.loyalty+"</loyalty>\r\n";
	if(card.power !== "") {
		contents += " <pt>" + card.power + "/" + card.toughness+"</pt>\r\n";
	}
	contents += " <type>"+xmlEscape(card.typeLine.replace(/ $/,""))+"</type>\r\n";
	contents += " <tablerow>";
	if(card.cardType.match(/(Instant|Sorcery)/)) {
		contents += "3";
	}else if(card.cardType.match(/Land/)) {
		contents += "0";
	}else if(card.cardType.match(/Creature/)) {
		contents += "2";
	}else{
		contents += "1";
	}
	contents += "</tablerow>\r\n";
	contents += " <text>"+xmlEscape(card.rulesText.replace(/\n/g," "))+"</text>\r\n";
	contents += " <token>1</token>\r\n";
	contents += " <set num=\"" + card.cardID + "\" rarity=\"" + card.rarity + "\">" + card.setID + "</set>\r\n"
	if(card.rulesText.match(/enters (the battlefield )?tapped./))
		contents += " <cipt>1</cipt>\r\n";
	
	for(let s in card.spellbook) {
		contents += `\t\t\t<related persistent="persistent">${xmlEscape(card.spellbook[s])}</related>\r\n`;
	}
	for(let c in card_sources) {
		let sources = card_sources[c];
		let source_names = library.cards[c].sourceNames;
		for(let i in sources) {
			for(let n in source_names) {
				if(source_names[n] == "")
					continue;
				contents += " <reverse-related"
				if(sources[i] == "transform") {
					contents += ` attach="transform"`;
				}
				else if(sources[i] != 1) {
					contents += ` count="${sources[i]}"`
				}
				contents += `>${xmlEscape(source_names[n])}</reverse-related>\r\n`
			}
		}
	}
	contents += "</card>\r\n";
	return contents;
}
function sourceNames(card) {
	let cardNames = [card.cardName, ""];
	if(card.hasOwnProperty("cardName2")) {
		switch(card.shape) {
			case "doubleface":
				cardNames[1] = card.cardName2;
				break;
			case "split":
			case "aftermath":
				cardNames[0] += " // " + card.cardName2;
				break;
		}
	}
	if(card.hasOwnProperty("hidden")) {
		cardNames = card.hidden.split("__")
		cardNames.push("");
	}
	else if(card.alias) {
		cardNames[0] += " (" + card.alias + ")";
	}else if(card.rarity == "special" && card.rarities.length > 1) {
		cardNames[0] += "_PRO";
		if(cardNames[1])
			cardNames[1] += "_PRO";
	}
	cardNames[0].replace(/’/g,"'");
	if(cardNames[1])
		cardNames[1].replace(/’/g,"'");
	let tag_set = card.notes.includes("reprint") && !card.alias && !card.hidden && !card.notes.includes("tag_exempt");
	if(library.legal.rotated && library.legal.rotated.includes(card.setID))
		tag_set = true;
	if(!tag_set && tracker.hasOwnProperty(cardNames[0])) {
		if(!tracker.hasOwnProperty(cardNames[0]+"_"+card.setID))
			tag_set = true;
	}
	if(tag_set) {
		cardNames[0] += `_${card.setID}`;
		if(cardNames[1])
			cardNames[1] += `_${card.setID}`;
	}
	else if(card.setID == "tokens") {
		cardNames[0] += ` ${card.parentSet}`
		if(cardNames[1])
			cardNames[1] += ` ${card.parentSet}`
	}
	
	if(tracker.hasOwnProperty(cardNames[0])) {
		cardNames[0] += " " + card.cardID;
		if(cardNames[1])
			cardNames[1] += " " + card.cardID;
	}

	if(tag_set && library.legal.rotation && library.legal.rotation.includes(card.setID)) {
		// this card is tagged due to being a reprint
		let fp = card.firstPrint;
		if(!library.legal.rotation.includes(library.cards[fp].setID)) {
			// and the first print is out of rotation
			// check if any tag_exempt printings exist
			let ap = [];
			for(let c in library.cards) {
				if(library.cards[c].firstPrint == fp)
					ap.push(library.cards[c]);
			}
			let exm = false;
			let old;
			for(let p in ap) {
				if(!old && library.legal.rotation.includes(ap[p].setID))
					old = ap[p]; // save oldest in rotation
				if(ap[p].notes.includes("tag_exempt")) {
					exm = true;
					break;
				}
			}
			if(!exm && card.setID == old.setID) {
				// all cards are tagged, make a dupe of the oldest
				cardNames.push(cardNames[0] + "_" + card.setID);
				if(cardNames[1])
					cardNames.push(cardNames[1] + "_" + card.setID);
			}
		}
	}
	if(!card.sourceNames)
		card.sourceNames = [];
	card.sourceNames = card.sourceNames.concat(cardNames);
	return cardNames;
}
function tokenNamerSimple(card) {
	let tokenSetCode = pullTokenSet(card, library.setData);
	
	if(card.fullName == "Revived " + card.cardName)
		return "revived " + card.cardName + " " + tokenSetCode;
	if(predef.includes(card.cardName))
		return card.cardName;
	if(card.fullName.match(/Reminder|Emblem/))
		return card.fullName + " " + tokenSetCode;
	let card_name = card.cardName;
	if(card.hidden)
		card_name = card.hidden;
	if(!card.typeLine.match(escapeRegex(card_name.replace(/\*/g,""))))
		return card_name + " " + tokenSetCode;
	let waydualsarray = ["Plains Island","Island Swamp","Swamp Mountain","Mountain Forest","Forest Plains","Plains Swamp","Island Mountain","Swamp Forest","Mountain Plains","Forest Island"];
	if(waydualsarray.includes(card_name)) {
		if(tokenSetCode == "WAY")
			return card_name;
		return card_name + " " + tokenSetCode;
	}
	
	let tokenPT = "" + card.power + card.toughness;
	if(tokenPT == "/" || tokenPT.match("★") || tokenPT.match("X"))
		tokenPT = "";
	let tokenColor = colorTranslate(card.color, "long");
	let tokenType = card.typeLine.replace(/(Basic |Snow |Token |Artifact |Creature |Enchantment |Land |Emblem )/g,"");
	let paren = card.fullName.match(/\(([^)]+)\)/);
	let parenText = "";
	if(paren)
		parenText = ` (${paren[1]})`
	let tokenName = tokenColor +  " " + tokenType.replace("— ","") + parenText + " " + tokenPT;
	if(card.typeLine.match("Legendary") || !card.typeLine.match("—"))
		tokenName = card_name + " ";
	if(card.typeLine.match("Emblem"))
		tokenName = tokenType.replace("— ","") + " Emblem ";
	tokenName = tokenName.replace(/  /g, " ");
	tokenName += tokenSetCode;

	return tokenName;
}
function colorTranslate(str, kind) {
	let tokenColor = "multicolor";
	let tokenInit = "";
	let silver = false;
	if(str.match(/Silver/)) {
		silver = true;
		str = str.replace(/\/?Silver\/?/);
	}
	switch(str) {
		case "":
			tokenColor = "colorless";
			break;
		case "{White} ":
			tokenColor = "white";
			tokenInit = "W";
			break;
		case "{Blue} ":
			tokenColor = "blue";
			tokenInit = "U";
			break;
		case "{Black} ":
			tokenColor = "black";
			tokenInit = "B";
			break;
		case "{Red} ":
			tokenColor = "red";
			tokenInit = "R";
			break;
		case "{Green} ":
			tokenColor = "green";
			tokenInit = "G";
			break;
		case "{White/Green} ":
		case "{Green/White} ":
			tokenColor = "green and white";
			tokenInit = "GW";
			break;
		case "{White/Blue} ":
		case "{Blue/White} ":
			tokenColor = "white and blue";
			tokenInit = "WU";
			break;
		case "{Blue/Black} ":
		case "{Black/Blue} ":
			tokenColor = "blue and black";
			tokenInit = "UB";
			break;
		case "{Black/Red} ":
		case "{Red/Black} ":
			tokenColor = "black and red";
			tokenInit = "BR";
			break;
		case "{Red/Green} ":
		case "{Green/Red} ":
			tokenColor = "red and green";
			tokenInit = "RG";
			break;
		case "{White/Black} ":
		case "{Black/White} ":
			tokenColor = "white and black";
			tokenInit = "WB";
			break;
		case "{Blue/Red} ":
		case "{Red/Blue} ":
			tokenColor = "blue and red";
			tokenInit = "UR";
			break;
		case "{Green/Black} ":
		case "{Black/Green} ":
			tokenColor = "black and green";
			tokenInit = "BG";
			break;
		case "{Red/White} ":
		case "{White/Red} ":
			tokenColor = "red and white";
			tokenInit = "RW";
			break;
		case "{Green/Blue} ":
		case "{Blue/Green} ":
			tokenColor = "blue and green";
			tokenInit = "GU";
			break;
		case "{Green/White/Blue} ":
			tokenInit = "GWU";
			break;
		case "{White/Blue/Black} ":
			tokenInit = "WUB";
			break;
		case "{Blue/Black/Red} ":
			tokenInit = "UBR";
			break;
		case "{Black/Red/Green} ":
			tokenInit = "BRG";
			break;
		case "{Red/Green/White} ":
			tokenInit = "RGW";
			break;
		case "{White/Black/Green} ":
			tokenInit = "WBG";
			break;
		case "{Blue/Red/White} ":
			tokenInit = "URW";
			break;
		case "{Black/Green/Blue} ":
			tokenInit = "BGU";
			break;
		case "{Red/White/Black} ":
			tokenInit = "RWB";
			break;
		case "{Green/Blue/Red} ":
			tokenInit = "GUR";
			break;
		case "{White/Blue/Black/Red/Green} ":
			tokenColor = "all colors";
			tokenInit = "WUBRG";
			break;
	}
	if(silver)
		tokenInit += "I";
	if(kind == "long")
		return tokenColor;
	return tokenInit;
}
function arrangeTokenColors(srcs) {
	let colors = [];
	let map = {"white": "W", "blue": "U", "black": "B", "red": "R", "green": "G", "W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}
	for(let s in srcs) {
		if(!srcs[s])
			continue;
		if(srcs[s].match(/colorless/))
			return "colorless";
		let cm = srcs[s].match(/(white|blue|black|red|green)/);
		if(cm) {
			let c = map[cm[1]];
			if(!colors.includes(c))
				colors.push(c);
		}
	}
	if(!colors.length)
		return "";
	let order = stitch.arrangeColors(colors);
	let fixed = [];
	for(let o in order)
		fixed.push(map[order[o]]);
	let res = "";
	switch(fixed.length) {
		case 0:
			res = "";
			break;
		case 1:
			res = fixed[0];
			break;
		case 2:
			res = `${fixed[0]} and ${fixed[1]}`;
			break;
		default:
			for(let i=0; i<fixed.length-1; i++) {
				res += fixed[i] + ", ";
			}
			res += "and " + fixed[fixed.length-1];
			break;
	}
	return res;
}
function pullTokenSet(card, setbase) { //determines what set a token belongs to
	let test = card.cardID.replace(/\d+$/, "");
	if(setbase[test])
		return test;
	for(let set in setbase) {
		if(card.cardID.match(new RegExp("^" + escapeRegex(set) + "\\d+s?$", "")))
			return set;
		if(card.setID == set)
			return set;
	}
	return "MSEMAR";
}
function tokenAliases(card) {
	let names = [tokenNamer(card)];
	if(card.tokenscripts && card.tokenscripts.t) {
		let ttags = card.tokenscripts.t.split(";");
		for(let t in ttags) {
			if(ttags[t] != "")
				names.push(ttags[t]);
		}
	}
	// the token without its colors, for reminder text
	names.push(tokenNamer(card, {color:true}));
	// various names for emblems
	if(card.typeLine.match(/Emblem/)) {
		let subtype = card.typeLine.match(/— (.+) */);
		if(subtype) {
			names.push(`${subtype[1]} Emblem`);
		}
		if(card.cardName != "Emblem")
			names.push(`${card.cardName} Emblem`);
	}
	return names;
}
function tokenNamer(card, skips) {
	if(!skips)
		skips = {};
	// if the token is an emblem, use it's full name
	// if the token has an explicit name, use that
	// if not, find its color, card type, subtypes, pt, and abilities
	if(card.typeLine.match(/Emblem/))
		return card.fullName;
	if(skips.shout)
		console.log(card);
	let token_name, token_subtypes, token_pt, token_abilities;
	let token_color_a, token_color_b;
	let token_types = [];
	let split_type = card.typeLine.split(/ — /);
	if(split_type[1]) {
		token_subtypes = split_type[1].replace(/ +$/, "");
	}
	token_name = card.cardName.replace(/ Token$/, "").replace();
	if(skips.shout) {
		console.log(token_name, token_subtypes);
	}
	if(token_name != token_subtypes) {
		// token has explicit name
		return token_name;
	}
	
	let c_map = {"W":"white", "U":"blue", "B":"black", "R":"red", "G":"green"}
	switch(card.colorIdentity.length) {
		case 0:
			token_color_a = "colorless";
			break;
		case 1:
			token_color_a = c_map[card.colorIdentity[0]];
			break;
		case 2:
			token_color_a = c_map[card.colorIdentity[0]] + " and " + c_map[card.colorIdentity[1]];
			break;
		case 3:
			token_color_a = c_map[card.colorIdentity[0]] + ", " + c_map[card.colorIdentity[1]] + ", and " + c_map[card.colorIdentity[2]];
			break;
		case 4:
			token_color_b = "that's " + c_map[card.colorIdentity[0]] + ", " + c_map[card.colorIdentity[1]] + ", " + c_map[card.colorIdentity[2]] + ", and " + c_map[card.colorIdentity[3]];
			break;
		case 5:
			token_color_b = "that's all colors";
			break;
	}
	
	let typeOrder = ["Enchantment", "Artifact", "Land", "Planeswalker", "Creature"];
	for(let t in typeOrder) {
		if(card.typeLine.match(typeOrder[t]))
			token_types.push(typeOrder[t].toLowerCase());
	}
	if(token_types.includes("land")) {
		token_color_a = "colorless";
		token_color_b = null;
	}
	token_types = token_types.join(" ");
	
	if(card.power || card.toughness)
		token_pt = `${card.power}/${card.toughness}`.replace(/[*★]/g, "X");
	
	let token_name_pieces = [];
	if(token_pt && !skips.pt)
		token_name_pieces.push(token_pt);
	if(token_color_a && !skips.color)
		token_name_pieces.push(token_color_a);
	if(token_subtypes && !skips.subtype)
		token_name_pieces.push(token_subtypes);
	if(token_types && !skips.type)
		token_name_pieces.push(token_types);
	if(token_color_b && !skips.color)
		token_name_pieces.push(token_color_b);
	
	let token_base_name = token_name_pieces.join(" ");
	
	token_abilities = card.rulesText.replace(/This (creature |token )?is all colors./, "");
	token_abilities = token_abilities.replace(/Haste/i, "");
	token_abilities = token_abilities.replace(/ ?\*[^*]+\*/, "");
	// predefined tokens
	if(predef.includes(token_subtypes))
		return token_subtypes;
	if(token_abilities == "" || token_abilities == "\n" || skips.ability) {
		//no abilities
		return token_base_name;
	}else{
		return token_base_name + " with some other stuff";
	}
}
function cardDebugger(c) {
	let thisCard = library.cards[c];
	console.log(tokenPuller(c, true));
	let conj = thisCard.rulesText.match(stitch.conjureRegexG);
	for(let c in conj) {
		console.log(conj[c].match(stitch.conjureRegex))
	}
}

function testTokens(data) {
	let stitch = require('./stitch.js');
	let ar;
	try{
		ar = JSON.parse(data);
	}catch(e){
		console.log(e);
		return "LackeyBot was unable to read this file.";
	}
	let lib = stitch.arrayStitch(ar);
	initialize(lib);
	
	let resp = tokenBuilding({reportTokens:true});
	return resp;
}
if(require.main === module && process.argv[2] != undefined) {
	initialize(process.argv[2]);
	tokenBuilding({writeTokens:'./triceFiles/tokens.xml'});
	//cardDebugger("Collector's Vault_TKN_INK");
	//console.log(tokenNamer(library.cards["Scout_TKN_MPS_MSE"]))
}

exports.keysToNames = keysToNames;
exports.initialize = initialize;
exports.tokenBuilding = tokenBuilding;
exports.cardBuilding = cardBuilding;
exports.testTokens = testTokens;
exports.writeTokensFile = writeTokensFile;