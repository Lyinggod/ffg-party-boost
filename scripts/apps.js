import { MODULE_ID, ALL_BONUS_TYPES } from "./settings.js";

// --- 1. The Main Bar UI ---
export class BonusBar extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-bonus-bar",
            template: `modules/${MODULE_ID}/templates/bonus-bar.hbs`,
            popOut: false
        });
    }

    async getData() {
        const position = game.settings.get(MODULE_ID, "barPosition");
        const trackedData = game.settings.get(MODULE_ID, "trackedActors");
        const maskNPCs = game.settings.get(MODULE_ID, "showNPCBonuses");
        const isGM = game.user.isGM;
        const tooltipDirection = position === "bottom" ? "UP" : "DOWN";

        const actors = [];
        
        const buildResArray = (resData) => {
            const arr = [];
            const add = (key, type, char, css) => {
                if (resData[key] > 0) arr.push({ value: resData[key], type, char, cssClass: css });
            };
            add("boost", "starwars", "b", "boost");
            add("setback", "starwars", "b", "setback");
            add("ability", "starwars", "d", "ability");
            add("difficulty", "starwars", "d", "difficulty");
            add("proficiency", "starwars", "c", "proficiency");
            add("challenge", "starwars", "c", "challenge");
            add("upgradeSkill", "starwars", "c", "proficiency upgrade-die");
            add("upgradeDifficulty", "starwars", "c", "challenge upgrade-die");
            add("success", "genesys", "s", "success");
            add("failure", "genesys", "f", "failure");
            add("advantage", "genesys", "a", "advantage");
            add("threat", "genesys", "h", "threat");
            add("triumph", "genesys", "t", "triumph");
            add("despair", "genesys", "d", "despair");
            return arr;
        };
        
        // Generic PC
        const pcData = trackedData["generic-pc"] || {};
        const pcRes = buildResArray(pcData.resources || {});
        actors.push({
            id: "generic-pc",
            name: "PC",
            isGeneric: true,
            shouldRender: true,
            resources: pcRes
        });

        // Generic NPC
        const hideNPCs = (!isGM && maskNPCs);
        if (isGM || !hideNPCs) {
            const npcData = trackedData["generic-npc"] || {};
            const npcRes = buildResArray(npcData.resources || {});
            actors.push({
                id: "generic-npc",
                name: "NPC",
                isGeneric: true,
                shouldRender: true,
                resources: npcRes
            });
        }

        // Specific Actors
        for (const [id, data] of Object.entries(trackedData)) {
            if (id === "generic-pc" || id === "generic-npc") continue; 

            const actor = game.actors.get(id);
            if (!actor) continue;

            if (data.hidden && !isGM) continue;
            if (actor.type !== "character" && hideNPCs) continue;

            const tokenImg = actor.prototypeToken?.texture?.src;
            const actorImg = actor.img;
            const displayImg = (tokenImg && tokenImg !== "icons/svg/mystery-man.svg") ? tokenImg : actorImg;
            
            const resources = buildResArray(data.resources || {});

            actors.push({
                id: actor.id,
                name: actor.name,
                img: displayImg,
                shouldRender: true,
                isGeneric: false,
                resources: resources
            });
        }

        return { position, actors, isGM, tooltipDirection };
    }

    async _render(force, options) {
        await super._render(force, options);
        const position = game.settings.get(MODULE_ID, "barPosition");
        const target = position === "top" ? $("#ui-top") : $("#ui-bottom");
        if (target.length) {
            if (position === "top") target.prepend(this.element);
            else target.append(this.element);
        }
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find(".config-btn").click(ev => {
            new ActorSelector().render(true);
        });
        if (game.user.isGM) {
            html.find(".token-image, .generic-label").click(ev => {
                const actorId = ev.currentTarget.closest(".ffg-bar-item").dataset.actorId;
                new ResourceEditor(actorId).render(true);
            });
        }
    }
}

// --- 2. The Actor Selector ---
export class ActorSelector extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-actor-selector",
            title: game.i18n.localize("FFGPartyBoost.Selector.Title"),
            template: `modules/${MODULE_ID}/templates/actor-selector.hbs`,
            width: 400,
            height: "auto"
        });
    }

    getData() {
        const trackedData = game.settings.get(MODULE_ID, "trackedActors");
        
        const groups = {
            players: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Players"), actors: [] },
            nemesis: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Nemesis"), actors: [] },
            rival: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Rival"), actors: [] },
            minion: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Minion"), actors: [] },
            vehicle: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Vehicle"), actors: [] }
        };

        game.actors.forEach(a => {
            const isTracked = a.id in trackedData;
            const isHidden = isTracked ? trackedData[a.id].hidden : false;
            const entry = { id: a.id, name: a.name, tracked: isTracked, hidden: isHidden };

            if (a.hasPlayerOwner) {
                groups.players.actors.push(entry);
            } else {
                switch (a.type) {
                    case "nemesis":
                        groups.nemesis.actors.push(entry);
                        break;
                    case "rival":
                        groups.rival.actors.push(entry);
                        break;
                    case "minion":
                        groups.minion.actors.push(entry);
                        break;
                    case "vehicle":
                        groups.vehicle.actors.push(entry);
                        break;
                }
            }
        });

        return { groups };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find(".visibility-toggle").click(ev => {
            const icon = $(ev.currentTarget).find("i");
            if (icon.hasClass("fa-eye")) {
                icon.removeClass("fa-eye").addClass("fa-eye-slash");
            } else {
                icon.removeClass("fa-eye-slash").addClass("fa-eye");
            }
        });
    }

    async _updateObject(event, formData) {
        const newData = {};
        const currentData = game.settings.get(MODULE_ID, "trackedActors");
        
        if (currentData["generic-pc"]) newData["generic-pc"] = currentData["generic-pc"];
        if (currentData["generic-npc"]) newData["generic-npc"] = currentData["generic-npc"];

        let trackedIds = formData.track || [];
        if (!Array.isArray(trackedIds)) trackedIds = [trackedIds];
        const form = $(event.currentTarget);
        
        for (const id of trackedIds) {
            const existingRes = currentData[id]?.resources || {};
            const eyeBtn = form.find(`.visibility-toggle[data-actor-id="${id}"]`);
            const isHidden = eyeBtn.find("i").hasClass("fa-eye-slash");
            newData[id] = { hidden: isHidden, resources: existingRes };
        }
        await game.settings.set(MODULE_ID, "trackedActors", newData);
    }
}

// --- 3. The Resource Editor ---
export class ResourceEditor extends FormApplication {
    constructor(actorId) {
        super();
        this.actorId = actorId;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-resource-editor",
            template: `modules/${MODULE_ID}/templates/resource-editor.hbs`,
            width: 350,
            height: "auto"
        });
    }

    get title() {
        let name = "";
        if (this.actorId === "generic-pc") name = "PC";
        else if (this.actorId === "generic-npc") name = "NPC";
        else {
            const actor = game.actors.get(this.actorId);
            name = actor ? actor.name : "Unknown";
        }
        return game.i18n.format("FFGPartyBoost.Editor.Title", { name: name });
    }

    getData() {
        const allData = game.settings.get(MODULE_ID, "trackedActors");
        const visibleDice = game.settings.get(MODULE_ID, "editorVisibleDice");
        const actorData = allData[this.actorId] || {};
        const res = actorData.resources || {};
        
        const mkDie = (key, labelKey, type, char, css, isUpgrade = false) => {
            const upgradeHtml = isUpgrade ? '<span class="upgrade-plus">+</span>' : '';
            return {
                name: game.i18n.localize(labelKey),
                value: res[key] || 0,
                key: key,
                labelHtml: `<span class="dietype ${type} ${css}">${char}${upgradeHtml}</span>`
            }
        };

        const dice = {};
        const symbols = {};

        if (visibleDice.boost) dice.boost = mkDie("boost", "FFGPartyBoost.Editor.Dice.Boost", "starwars", "b", "boost");
        if (visibleDice.setback) dice.setback = mkDie("setback", "FFGPartyBoost.Editor.Dice.Setback", "starwars", "b", "setback");
        if (visibleDice.ability) dice.ability = mkDie("ability", "FFGPartyBoost.Editor.Dice.Ability", "starwars", "d", "ability");
        if (visibleDice.difficulty) dice.difficulty = mkDie("difficulty", "FFGPartyBoost.Editor.Dice.Difficulty", "starwars", "d", "difficulty");
        if (visibleDice.proficiency) dice.proficiency = mkDie("proficiency", "FFGPartyBoost.Editor.Dice.Proficiency", "starwars", "c", "proficiency");
        if (visibleDice.challenge) dice.challenge = mkDie("challenge", "FFGPartyBoost.Editor.Dice.Challenge", "starwars", "c", "challenge");
        if (visibleDice.upgradeSkill) dice.upgradeSkill = mkDie("upgradeSkill", "FFGPartyBoost.Editor.Dice.UpgradeSkill", "starwars", "c", "proficiency", true);
        if (visibleDice.upgradeDifficulty) dice.upgradeDifficulty = mkDie("upgradeDifficulty", "FFGPartyBoost.Editor.Dice.UpgradeDifficulty", "starwars", "c", "challenge", true);
        
        if (visibleDice.success) symbols.success = mkDie("success", "FFGPartyBoost.Editor.Symbols.Success", "genesys", "s", "success");
        if (visibleDice.failure) symbols.failure = mkDie("failure", "FFGPartyBoost.Editor.Symbols.Failure", "genesys", "f", "failure");
        if (visibleDice.advantage) symbols.advantage = mkDie("advantage", "FFGPartyBoost.Editor.Symbols.Advantage", "genesys", "a", "advantage");
        if (visibleDice.threat) symbols.threat = mkDie("threat", "FFGPartyBoost.Editor.Symbols.Threat", "genesys", "h", "threat");
        if (visibleDice.triumph) symbols.triumph = mkDie("triumph", "FFGPartyBoost.Editor.Symbols.Triumph", "genesys", "t", "triumph");
        if (visibleDice.despair) symbols.despair = mkDie("despair", "FFGPartyBoost.Editor.Symbols.Despair", "genesys", "d", "despair");

        return { dice, symbols };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find("button[data-action]").click(ev => {
            const btn = ev.currentTarget;
            const action = btn.dataset.action;
            const row = $(btn).closest(".controls");
            const valSpan = row.find(".value");
            let val = parseInt(valSpan.text());
            if (action === "increase") val++;
            if (action === "decrease" && val > 0) val--;
            valSpan.text(val);
        });
    }

    async _updateObject(event, formData) {
        const html = $(this.element);
        const newResources = {};
        html.find(".controls").each((i, el) => {
            const buttonElement = $(el).find("button").first().get(0);
            if (buttonElement) {
                const key = buttonElement.dataset.key;
                const val = parseInt($(el).find(".value").text());
                if (key && val > 0) newResources[key] = val;
            }
        });
        const allData = game.settings.get(MODULE_ID, "trackedActors");
        if (!allData[this.actorId]) allData[this.actorId] = {};
        allData[this.actorId].resources = newResources;
        await game.settings.set(MODULE_ID, "trackedActors", allData);
    }
}

// --- 4. The Dice Selector for Settings ---
export class DiceSelector extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-dice-selector",
            title: game.i18n.localize("FFGPartyBoost.Settings.DiceSelector.Title"),
            template: `modules/${MODULE_ID}/templates/dice-selector.hbs`,
            width: 400,
            height: "auto",
            classes: ["ffg-dice-selector-dialog"]
        });
    }

    getData() {
        const visibleDice = game.settings.get(MODULE_ID, "editorVisibleDice");
        
        const mkDie = (key, labelKey, type, char, css, isUpgrade = false) => {
            return {
                name: game.i18n.localize(labelKey),
                checked: !!visibleDice[key],
                type: type,
                css: css,
                char: char,
                isUpgrade: isUpgrade,
            };
        };

        const bonusTypes = {
            dice: {
                label: game.i18n.localize("FFGPartyBoost.Editor.Headers.Dice"),
                items: {
                    boost: mkDie("boost", "FFGPartyBoost.Editor.Dice.Boost", "starwars", "b", "boost"),
                    setback: mkDie("setback", "FFGPartyBoost.Editor.Dice.Setback", "starwars", "b", "setback"),
                    ability: mkDie("ability", "FFGPartyBoost.Editor.Dice.Ability", "starwars", "d", "ability"),
                    difficulty: mkDie("difficulty", "FFGPartyBoost.Editor.Dice.Difficulty", "starwars", "d", "difficulty"),
                    proficiency: mkDie("proficiency", "FFGPartyBoost.Editor.Dice.Proficiency", "starwars", "c", "proficiency"),
                    challenge: mkDie("challenge", "FFGPartyBoost.Editor.Dice.Challenge", "starwars", "c", "challenge"),
                    upgradeSkill: mkDie("upgradeSkill", "FFGPartyBoost.Editor.Dice.UpgradeSkill", "starwars", "c", "proficiency", true),
                    upgradeDifficulty: mkDie("upgradeDifficulty", "FFGPartyBoost.Editor.Dice.UpgradeDifficulty", "starwars", "c", "challenge", true)
                }
            },
            symbols: {
                label: game.i18n.localize("FFGPartyBoost.Editor.Headers.Symbols"),
                items: {
                    success: mkDie("success", "FFGPartyBoost.Editor.Symbols.Success", "genesys", "s", "success"),
                    failure: mkDie("failure", "FFGPartyBoost.Editor.Symbols.Failure", "genesys", "f", "failure"),
                    advantage: mkDie("advantage", "FFGPartyBoost.Editor.Symbols.Advantage", "genesys", "a", "advantage"),
                    threat: mkDie("threat", "FFGPartyBoost.Editor.Symbols.Threat", "genesys", "h", "threat"),
                    triumph: mkDie("triumph", "FFGPartyBoost.Editor.Symbols.Triumph", "genesys", "t", "triumph"),
                    despair: mkDie("despair", "FFGPartyBoost.Editor.Symbols.Despair", "genesys", "d", "despair")
                }
            }
        };

        return { bonusTypes };
    }
    
    async _updateObject(event, formData) {
        const newSettings = {};
        for (const key of Object.keys(ALL_BONUS_TYPES)) {
            newSettings[key] = formData[key] || false;
        }
        await game.settings.set(MODULE_ID, "editorVisibleDice", newSettings);
    }
}