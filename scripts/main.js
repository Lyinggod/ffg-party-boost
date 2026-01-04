import { registerSettings, MODULE_ID } from "./settings.js";
import { BonusBar } from "./apps.js";

Hooks.once("init", () => {
    registerSettings();

    // FIX: Register the Handlebars helper to check the length of an object.
    Handlebars.registerHelper("objLength", function(obj) {
        if (typeof obj === "object" && obj !== null) {
            return Object.keys(obj).length;
        }
        return 0;
    });
});

Hooks.once("ready", () => {
    console.info(game.i18n.localize("FFGPartyBoost.Notifications.Init"));
    
    // 1. Initialize the Bonus Bar UI
    ui.ffgBonusBar = new BonusBar();
    ui.ffgBonusBar.render(true);

    // 2. Register Socket Listener for resource consumption
    game.socket.on(`module.${MODULE_ID}`, async (payload) => {
        if (payload.type === "consume" && game.user.isGM) {
            await consumeResources(payload.keys);
        }
    });

    // 3. Patch the Dice Roller
    patchRollBuilder();
});

Hooks.on("closeSettingsConfig", () => {
    if (ui.ffgBonusBar) ui.ffgBonusBar.render();
});

/**
 * Hook into the creation of chat messages to consume resources after a roll is made.
 */
Hooks.on("createChatMessage", async (message) => {
    // Filter 1: Only act on FFG dice rolls.
    if (message.rolls.length == 0) return
console.info("message",message)
   // if (!message.isRoll || !message.flags?.starwarsffg) return;
    
    // Filter 2: Only the user who made the roll should trigger consumption.
    if (message.author.id !== game.user.id) return;

    const speaker = message.speaker;
    if (!speaker.actor) return;
    
    const actor = game.actors.get(speaker.actor);
    if (!actor) return;
    const allData = game.settings.get(MODULE_ID, "trackedActors");
    const keysToConsume = [];

    // --- 1. Check if Generic Bonuses were available to be consumed ---
    let genericKey = null;
    const type = actor.type.toLowerCase();

    if (type === "character") {
        genericKey = "generic-pc";
    } else if (["minion", "rival", "nemesis"].includes(type)) {
        genericKey = "generic-npc";
    }

    if (genericKey && allData[genericKey]?.resources && Object.keys(allData[genericKey].resources).length > 0) {
        keysToConsume.push(genericKey);
    }

    // --- 2. Check if Specific Actor Bonuses were available to be consumed ---
    if (allData[actor.id]?.resources && Object.keys(allData[actor.id].resources).length > 0) {
        keysToConsume.push(actor.id);
    }

    // --- 3. If there are keys to consume, either do it directly (GM) or ask via socket (Player) ---
    if (keysToConsume.length > 0) {
        if (game.user.isGM) {
            await consumeResources(keysToConsume);
        } else {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "consume",
                keys: keysToConsume
            });
        }
    }
});

/**
 * Zeros out resources for given keys. Only ever run by a GM.
 */
async function consumeResources(keys) {
    if (!keys || keys.length === 0) return;

    const allData = game.settings.get(MODULE_ID, "trackedActors");
    let changed = false;

    for (const key of keys) {
        if (allData[key] && allData[key].resources && Object.keys(allData[key].resources).length > 0) {
            allData[key].resources = {}; // Clear resources
            changed = true;
            console.info(`FFG Party Boosts | Consumed resources for: ${key}`);
        }
    }

    if (changed) {
        await game.settings.set(MODULE_ID, "trackedActors", allData);
    }
}

// --- Dice Roller Patching ---

function findRollBuilderClass() {
    if (game.ffg && game.ffg.RollBuilderFFG) return game.ffg.RollBuilderFFG;
    if (game.starwarsffg && game.starwarsffg.RollBuilderFFG) return game.starwarsffg.RollBuilderFFG;
    if (window.RollBuilderFFG) return window.RollBuilderFFG;
    const classes = Object.values(CONFIG.classes || {});
    return classes.find(c => c.name === "RollBuilderFFG") || null;
}

function patchRollBuilder() {
    const RollBuilderFFG = findRollBuilderClass();
    if (!RollBuilderFFG) {
        console.error(game.i18n.localize("FFGPartyBoost.Notifications.ErrorRef"));
        return;
    }

    const originalGetData = RollBuilderFFG.prototype.getData;

    RollBuilderFFG.prototype.getData = async function() {
        if (!this._partyBoostsApplied) {
            this._partyBoostsApplied = true;
            await applyStoredBoosts(this); // This now ONLY adds dice, doesn't consume.
        }
        return await originalGetData.call(this);
    };
}

async function applyStoredBoosts(app) {
    const rollData = app.roll?.data;
    if (!rollData) return;

    let actorId = rollData.actor?._id || rollData.actor?.id;
    if (!actorId) return;
    
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const allData = game.settings.get(MODULE_ID, "trackedActors");
    let modified = false;
    const pool = app.dicePool;
    if (!pool) return;

    const applyResources = (res) => {
        if (!res) return;
        
        // Handle special "Upgrade" logic first.
        const skillUpgrades = res.upgradeSkill || 0;
        for (let i = 0; i < skillUpgrades; i++) {
            if (parseInt(pool.ability) > 0) {
                pool.ability = parseInt(pool.ability) - 1;
                pool.proficiency = (parseInt(pool.proficiency) || 0) + 1;
            } else {
                pool.ability = (parseInt(pool.ability) || 0) + 1;
            }
            modified = true;
        }

        const diffUpgrades = res.upgradeDifficulty || 0;
        for (let i = 0; i < diffUpgrades; i++) {
            if (parseInt(pool.difficulty) > 0) {
                pool.difficulty = parseInt(pool.difficulty) - 1;
                pool.challenge = (parseInt(pool.challenge) || 0) + 1;
            } else {
                pool.difficulty = (parseInt(pool.difficulty) || 0) + 1;
            }
            modified = true;
        }

        // Handle standard additions.
        const add = (prop, amount) => {
            if (amount > 0) {
                pool[prop] = (parseInt(pool[prop]) || 0) + amount;
                modified = true;
            }
        };
        add("boost", res.boost);
        add("setback", res.setback);
        add("ability", res.ability);
        add("difficulty", res.difficulty);
        add("proficiency", res.proficiency);
        add("challenge", res.challenge);
        add("success", res.success);
        add("failure", res.failure);
        add("advantage", res.advantage);
        add("threat", res.threat);
        add("triumph", res.triumph);
        add("despair", res.despair);
    };

    // --- 1. Apply Generics based on Type ---
    let genericKey = null;
    const type = actor.type.toLowerCase();

    if (type === "character") {
        genericKey = "generic-pc";
    } else if (["minion", "rival", "nemesis"].includes(type)) {
        genericKey = "generic-npc";
    }

    if (genericKey && allData[genericKey]?.resources) {
        applyResources(allData[genericKey].resources);
    }

    // --- 2. Apply Specific Actor Bonuses ---
    if (allData[actorId]?.resources) {
        applyResources(allData[actorId].resources);
    }

    if (modified) {
        const actorName = rollData.actor.name;
        ui.notifications.info(game.i18n.format("FFGPartyBoost.Notifications.Applied", { name: actorName }));
        // Consumption is now handled by the chat message hook, so we do nothing more here.
    }
}