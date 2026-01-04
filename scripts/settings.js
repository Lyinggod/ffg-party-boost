import { DiceSelector } from "./apps.js";

export const MODULE_ID = "ffg-party-boost";

export const ALL_BONUS_TYPES = {
    boost: true,
    setback: true,
    ability: true,
    difficulty: true,
    proficiency: true,
    challenge: true,
    upgradeSkill: true,
    upgradeDifficulty: true,
    success: true,
    failure: true,
    advantage: true,
    threat: true,
    triumph: true,
    despair: true,
};

// Helper to generate the default visibility settings object
function getDefaultVisibility() {
    const defaults = {};
    for (const key of Object.keys(ALL_BONUS_TYPES)) {
        defaults[key] = {
            enabled: true,
            visibleToPlayers: true,
        };
    }
    return defaults;
}


export function registerSettings() {
    // 1. Position of the bar (Top/Bottom)
    game.settings.register(MODULE_ID, "barPosition", {
        name: "FFGPartyBoost.Settings.BarPosition.Name",
        hint: "FFGPartyBoost.Settings.BarPosition.Hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "top": "FFGPartyBoost.Settings.BarPosition.Top",
            "bottom": "FFGPartyBoost.Settings.BarPosition.Bottom"
        },
        default: "bottom",
        onChange: () => {
            if (ui.ffgBonusBar) ui.ffgBonusBar.render();
        }
    });

    // 2. Setting to Control NPC Visibility
    game.settings.register(MODULE_ID, "showNPCBonuses", {
        name: "FFGPartyBoost.Settings.ShowNPC.Name",
        hint: "FFGPartyBoost.Settings.ShowNPC.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (ui.ffgBonusBar) ui.ffgBonusBar.render();
        }
    });
    
    // NEW: Setting to allow players to pass bonuses
    game.settings.register(MODULE_ID, "playersCanPassBonuses", {
        name: "FFGPartyBoost.Settings.PlayersPassBonuses.Name",
        hint: "FFGPartyBoost.Settings.PlayersPassBonuses.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (ui.ffgBonusBar) ui.ffgBonusBar.render();
        }
    });

    // NOTE: The 'trackedActors' setting has been removed and is now managed per-scene via flags.

    // 4. Button to launch Dice Selector
    game.settings.registerMenu(MODULE_ID, "diceVisibilityMenu", {
        name: "FFGPartyBoost.Settings.DiceVisibility.Name",
        label: "FFGPartyBoost.Settings.DiceVisibility.Label",
        hint: "FFGPartyBoost.Settings.DiceVisibility.Hint",
        icon: "fas fa-dice",
        type: DiceSelector,
        restricted: true
    });

    // 5. The Dice Visibility Data Store (Hidden) - UPDATED STRUCTURE
    game.settings.register(MODULE_ID, "editorVisibleDice", {
        scope: "world",
        config: false,
        type: Object,
        default: getDefaultVisibility(),
    });
}