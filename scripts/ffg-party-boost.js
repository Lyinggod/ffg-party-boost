import { registerSettings, MODULE_ID } from "./settings.js";
import { BonusBar, getSceneTrackedActors } from "./apps.js";

Hooks.once("init", () => {
    registerSettings();
});

Hooks.once("ready", () => {
    console.info(game.i18n.localize("FFGPartyBoost.Notifications.Init"));
    
    // 1. Initialize the Bonus Bar UI
    ui.ffgBonusBar = new BonusBar();
    ui.ffgBonusBar.render(true);

    // 2. Register Socket Listener for various actions
    game.socket.on(`module.${MODULE_ID}`, async (payload) => {
        // All actions must be handled by a GM client.
        if (game.user.isGM) {
            switch (payload.type) {
                case "consume":
                    await consumeResources(payload.keys);
                    break;
                case "addBonuses":
                    const { sceneId, actorId, resourcesToAdd } = payload.payload;
                    await addResources(sceneId, actorId, resourcesToAdd);
                    break;
            }
        }
    });

    // 3. Patch the Dice Roller
    patchRollBuilder();
});

// Re-render the bar on scene changes
Hooks.on("canvasReady", () => {
    if (ui.ffgBonusBar) {
        ui.ffgBonusBar.render();
    }
});

// Re-render the bar if the scene flags are updated by anyone
Hooks.on("updateScene", (scene) => {
    if (scene.id === canvas.scene?.id && ui.ffgBonusBar) {
        ui.ffgBonusBar.render();
    }
});


/**
 * Hook into the creation of chat messages to consume resources after a roll is made.
 */
Hooks.on("createChatMessage", async (message) => {
    if (message.rolls.length == 0) return;
    if (message.author.id !== game.user.id) return;

    const speaker = message.speaker;
    if (!speaker) return;

    let actor = null;
    if (speaker.token) {
        const token = canvas.tokens.get(speaker.token);
        if (token?.actor) actor = token.actor;
    }
    if (!actor && speaker.actor) {
        actor = game.actors.get(speaker.actor);
    }
    if (!actor) return;
    
    const allData = await getSceneTrackedActors(canvas.scene);
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
 * Adds resources for a given actor ID. Only ever run by a GM.
 * @param {string} sceneId
 * @param {string} actorId
 * @param {object} resourcesToAdd
 */
async function addResources(sceneId, actorId, resourcesToAdd) {
    const scene = game.scenes.get(sceneId);
    if (!scene) return;

    const allData = await getSceneTrackedActors(scene);
    if (!allData[actorId]) allData[actorId] = { resources: {} };
    
    const currentResources = allData[actorId].resources || {};
    for (const key in resourcesToAdd) {
        currentResources[key] = (currentResources[key] || 0) + resourcesToAdd[key];
    }
    allData[actorId].resources = currentResources;
    
    await scene.setFlag(MODULE_ID, "trackedActors", allData);
    
    const actorName = actorId.startsWith('generic-') ? actorId.replace('generic-', '').toUpperCase() : game.actors.get(actorId)?.name;
    if (actorName) {
        ui.notifications.info(`Bonuses added to ${actorName}.`);
    }
}

/**
 * Zeros out resources for given keys. Only ever run by a GM.
 */
async function consumeResources(keys) {
    if (!keys || keys.length === 0 || !canvas.scene) return;

    const allData = await getSceneTrackedActors(canvas.scene);
    let changed = false;

    for (const key of keys) {
        if (allData[key]?.resources && Object.keys(allData[key].resources).length > 0) {
            // *** THE FIX IS HERE ***
            // Instead of clearing the object, iterate over its keys and set each value to 0.
            const resources = allData[key].resources;
            for (const resourceKey of Object.keys(resources)) {
                if (resources[resourceKey] > 0) {
                    resources[resourceKey] = 0;
                    changed = true;
                }
            }
            // ***********************
            if (changed) console.info(`FFG Party Boosts | Consumed resources for: ${key}`);
        }
    }

    if (changed) {
        await canvas.scene.setFlag(MODULE_ID, "trackedActors", allData);
    }
}

// --- Dice Roller Patching ---

function findRollBuilderClass() {
    if (game.ffg?.RollBuilderFFG) return game.ffg.RollBuilderFFG;
    if (game.starwarsffg?.RollBuilderFFG) return game.starwarsffg.RollBuilderFFG;
    if (window.RollBuilderFFG) return window.RollBuilderFFG;
    const classes = Object.values(CONFIG.classes || {});
    return classes.find(c => c.name === "RollBuilderFFG") || null;
}

function patchRollBuilder() {
    const RollBuilderFFG = findRollBuilderClass();
    if (!RollBuilderFFG) {
        ui.notifications.error("FFG Party Boosts | Could not find RollBuilderFFG. Boosts will not apply.");
        return;
    }

    const originalGetData = RollBuilderFFG.prototype.getData;

    RollBuilderFFG.prototype.getData = async function() {
        if (!this._partyBoostsApplied) {
            this._partyBoostsApplied = true;
            await applyStoredBoosts(this);
        }
        return await originalGetData.call(this);
    };
}

async function applyStoredBoosts(app) {
    const rollData = app.roll?.data;
    if (!rollData || !canvas.scene) return;

    let actorId = rollData.actor?._id || rollData.actor?.id;
    if (!actorId) return;
    
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const allData = await getSceneTrackedActors(canvas.scene);
    let modified = false;
    const pool = app.dicePool;
    if (!pool) return;

    const applyResources = (res) => {
        if (!res) return;
        
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

    if (allData[actorId]?.resources) {
        applyResources(allData[actorId].resources);
    }

    if (modified) {
        const actorName = rollData.actor.name;
        ui.notifications.info(game.i18n.format("FFGPartyBoost.Notifications.Applied", { name: actorName }));
    }
}