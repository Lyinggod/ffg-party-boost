import { MODULE_ID, ALL_BONUS_TYPES } from "./settings.js";

/**
 * Helper function to safely get the tracked actors for a given scene.
 * It ensures the flag exists and that generic PC/NPC entries are present.
 * @param {Scene} scene - The scene document to get flags from.
 * @returns {Promise<object>} A deep clone of the tracked actors object.
 */
export async function getSceneTrackedActors(scene) {
    if (!scene) return { 'generic-pc': { resources: {} }, 'generic-npc': { resources: {} } };
    
    let actors = scene.getFlag(MODULE_ID, "trackedActors");

    if (!actors || typeof actors !== 'object') {
        actors = {};
    }
    
    // Ensure generics always exist
    if (!actors['generic-pc']) actors['generic-pc'] = { resources: {} };
    if (!actors['generic-npc']) actors['generic-npc'] = { resources: {} };

    return foundry.utils.deepClone(actors);
}


// --- 1. The Main Bar UI ---
export class BonusBar extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-bonus-bar",
            template: `modules/${MODULE_ID}/templates/bonus-bar.html`,
            popOut: false
        });
    }

    async getData() {
        const position = game.settings.get(MODULE_ID, "barPosition");
        const trackedData = await getSceneTrackedActors(canvas.scene);
        const maskNPCs = !game.settings.get(MODULE_ID, "showNPCBonuses");
        const isGM = game.user.isGM;
        const tooltipDirection = position === "bottom" ? "UP" : "DOWN";
        const playersCanPass = game.settings.get(MODULE_ID, "playersCanPassBonuses");

        // --- Tooltip Color Logic ---
        const userColor = game.settings.get(MODULE_ID, "tooltipBackgroundColor");
        const defaultColor = "lightgrey";
        function isValidColor(colorString) {
            if (!colorString || typeof colorString !== 'string') return false;
            const s = new Option().style;
            s.color = colorString;
            return s.color !== "";
        }
        const tooltipColor = isValidColor(userColor) ? userColor : defaultColor;

        // --- NEW: Name Breaking Logic ---
        const shouldBreakNames = game.settings.get(MODULE_ID, "breakLongNames");
        const breakCharsSetting = game.settings.get(MODULE_ID, "nameBreakCharacters");

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
        
        for (const [id, data] of Object.entries(trackedData)) {
            let item = { id, resources: buildResArray(data.resources || {}), shouldRender: true };

            if (id === 'generic-pc') {
                item.name = 'PC';
                item.isGeneric = true;
            } else if (id === 'generic-npc') {
                item.name = 'NPC';
                item.isGeneric = true;
                if (maskNPCs && !isGM) item.shouldRender = false;
            } else {
                const actor = game.actors.get(id);
                if (!actor) {
                    item.shouldRender = false;
                } else {
                    if (data.hidden && !isGM) item.shouldRender = false;
                    if (actor.type !== "character" && maskNPCs && !isGM) item.shouldRender = false;
                    
                    const tokenImg = actor.prototypeToken?.texture?.src;
                    const actorImg = actor.img;
                    item.name = actor.name;
                    item.img = (tokenImg && tokenImg !== "icons/svg/mystery-man.svg") ? tokenImg : actorImg;
                    item.isGeneric = false;
                }
            }

            // --- Apply Name Breaking ---
            if (item.shouldRender && shouldBreakNames && item.name && breakCharsSetting) {
                const charsToBreak = breakCharsSetting
                    .split(',')
                    .map(c => c.trim().toLowerCase() === 'space' ? ' ' : c.trim())
                    .filter(c => c);

                if (charsToBreak.length > 0) {
                    const escapedChars = charsToBreak.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
                    const regex = new RegExp(`[${escapedChars}]`, 'g');
                    item.name = item.name.replace(regex, '<br>');
                }
            }

            if (item.shouldRender) actors.push(item);
        }

        return { position, actors, isGM, tooltipDirection, playersCanPass, tooltipColor };
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

        const canOpenEditor = game.user.isGM || game.settings.get(MODULE_ID, "playersCanPassBonuses");
        if (canOpenEditor) {
            html.find(".token-image, .generic-label").click(ev => {
                const actorId = ev.currentTarget.closest(".ffg-bar-item").dataset.actorId;
                new ResourceEditor(actorId).render(true);
            });
        }

        // --- TOOLTIP LOGIC ---
        const allItems = html.find('.ffg-bar-item');
        const allTooltips = html.find('.bar-item-tooltip');
        let isCtrlDown = false;
    
        const keydownHandler = (e) => {
            if (e.key === 'Control' && !isCtrlDown) {
                isCtrlDown = true;
                allTooltips.show();
            }
        };
    
        const keyupHandler = (e) => {
            if (e.key === 'Control') {
                isCtrlDown = false;
                allTooltips.hide();
                const currentlyHovered = allItems.filter(':hover').first();
                if (currentlyHovered.length > 0) {
                    currentlyHovered.find('.bar-item-tooltip').show();
                }
            }
        };
    
        html.on('mouseenter', () => {
            $(document).on('keydown.ffgBonusBar', keydownHandler);
            $(document).on('keyup.ffgBonusBar', keyupHandler);
        });
    
        html.on('mouseleave', () => {
            isCtrlDown = false;
            allTooltips.hide();
            $(document).off('.ffgBonusBar');
        });
    
        allItems.on('mouseenter', function() {
            if (!isCtrlDown) {
                $(this).find('.bar-item-tooltip').show();
            }
        }).on('mouseleave', function() {
            if (!isCtrlDown) {
                $(this).find('.bar-item-tooltip').hide();
            }
        });
    }
}

// --- 2. The Actor Selector ---
export class ActorSelector extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-actor-selector",
            title: game.i18n.localize("FFGPartyBoost.Selector.Title"),
            template: `modules/${MODULE_ID}/templates/actor-selector.html`,
            width: 400,
            height: "auto"
        });
    }

    async getData() {
        const trackedData = await getSceneTrackedActors(canvas.scene);

        const createGroupTemplate = () => ({
            players: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Players"), actors: [] },
            nemesis: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Nemesis"), actors: [] },
            rival: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Rival"), actors: [] },
            minion: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Minion"), actors: [] },
            vehicle: { label: game.i18n.localize("FFGPartyBoost.Selector.Groups.Vehicle"), actors: [] }
        });

        const canvasGroups = createGroupTemplate();
        const sidebarGroups = createGroupTemplate();
        const canvasActorIds = new Set();
        const canvasTokens = canvas.tokens?.placeables ?? [];

        for (const token of canvasTokens) {
            const actor = token.actor;
            if (!actor || actor.type === 'homestead') continue;
            canvasActorIds.add(actor.id);
            const isTracked = actor.id in trackedData;
            const isHidden = isTracked ? trackedData[actor.id]?.hidden : false;
            const entry = { id: actor.id, name: token.name, tracked: isTracked, hidden: isHidden };
            let targetGroup = actor.hasPlayerOwner ? canvasGroups.players : canvasGroups[actor.type];
            if (targetGroup) targetGroup.actors.push(entry);
        }

        for (const actor of game.actors) {
            if (canvasActorIds.has(actor.id) || actor.type === 'homestead') continue;
            const isTracked = actor.id in trackedData;
            const isHidden = isTracked ? trackedData[actor.id]?.hidden : false;
            const entry = { id: actor.id, name: actor.name, tracked: isTracked, hidden: isHidden };
            let targetGroup = actor.hasPlayerOwner ? sidebarGroups.players : sidebarGroups[actor.type];
            if (targetGroup) targetGroup.actors.push(entry);
        }

        return {
            canvasGroups,
            sidebarGroups,
            hasCanvasTokens: canvasTokens.length > 0
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find(".visibility-toggle").click(ev => {
            const icon = $(ev.currentTarget).find("i");
            icon.toggleClass("fa-eye fa-eye-slash");
        });
        html.find(".transfer-btn").click(ev => {
            new TransferActorsDialog().render(true);
        });
    }

    async _updateObject(event, formData) {
        if (!canvas.scene) return;
        const currentData = await getSceneTrackedActors(canvas.scene);
        const newData = {
            'generic-pc': currentData['generic-pc'],
            'generic-npc': currentData['generic-npc']
        };

        let trackedIds = formData.track || [];
        if (!Array.isArray(trackedIds)) trackedIds = [trackedIds];
        const form = this.form;
        
        for (const id of trackedIds) {
            const existingRes = currentData[id]?.resources || {};
            const eyeBtn = form.querySelector(`.visibility-toggle[data-actor-id="${id}"] i`);
            const isHidden = eyeBtn ? eyeBtn.classList.contains("fa-eye-slash") : false;
            newData[id] = { hidden: isHidden, resources: existingRes };
        }
        await canvas.scene.setFlag(MODULE_ID, "trackedActors", newData);
    }
}

// --- 3. The Resource Editor ---
export class ResourceEditor extends FormApplication {
    constructor(actorId) {
        super();
        this.actorId = actorId;
        this.originalResources = {}; // To store the state when the dialog opens
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-resource-editor",
            template: `modules/${MODULE_ID}/templates/resource-editor.html`,
            width: 350,
            height: "auto"
        });
    }

    get title() {
        let name = "";
        if (this.actorId === "generic-pc") name = "PC";
        else if (this.actorId === "generic-npc") name = "NPC";
        else name = game.actors.get(this.actorId)?.name ?? "Unknown";
        return game.i18n.format("FFGPartyBoost.Editor.Title", { name: name });
    }

    async getData() {
        const allData = await getSceneTrackedActors(canvas.scene);
        const visibleDice = game.settings.get(MODULE_ID, "editorVisibleDice");
        const actorData = allData[this.actorId] || {};
        
        // Store the original state for calculating diffs later
        this.originalResources = foundry.utils.deepClone(actorData.resources || {});
        const res = this.originalResources;
        
        // Determine if the decrease button should be visible
        const showDecreaseButton = game.user.isGM || game.settings.get(MODULE_ID, "playersCanReduceBonuses");

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
        
        const diceTypes = {
            boost: ["FFGPartyBoost.Editor.Dice.Boost", "starwars", "b", "boost", false, dice],
            setback: ["FFGPartyBoost.Editor.Dice.Setback", "starwars", "b", "setback", false, dice],
            ability: ["FFGPartyBoost.Editor.Dice.Ability", "starwars", "d", "ability", false, dice],
            difficulty: ["FFGPartyBoost.Editor.Dice.Difficulty", "starwars", "d", "difficulty", false, dice],
            proficiency: ["FFGPartyBoost.Editor.Dice.Proficiency", "starwars", "c", "proficiency", false, dice],
            challenge: ["FFGPartyBoost.Editor.Dice.Challenge", "starwars", "c", "challenge", false, dice],
            upgradeSkill: ["FFGPartyBoost.Editor.Dice.UpgradeSkill", "starwars", "c", "proficiency", true, dice],
            upgradeDifficulty: ["FFGPartyBoost.Editor.Dice.UpgradeDifficulty", "starwars", "c", "challenge", true, dice],
            success: ["FFGPartyBoost.Editor.Symbols.Success", "genesys", "s", "success", false, symbols],
            failure: ["FFGPartyBoost.Editor.Symbols.Failure", "genesys", "f", "failure", false, symbols],
            advantage: ["FFGPartyBoost.Editor.Symbols.Advantage", "genesys", "a", "advantage", false, symbols],
            threat: ["FFGPartyBoost.Editor.Symbols.Threat", "genesys", "h", "threat", false, symbols],
            triumph: ["FFGPartyBoost.Editor.Symbols.Triumph", "genesys", "t", "triumph", false, symbols],
            despair: ["FFGPartyBoost.Editor.Symbols.Despair", "genesys", "d", "despair", false, symbols],
        };

        for (const [key, args] of Object.entries(diceTypes)) {
            const dieConfig = visibleDice[key];
            if (!dieConfig?.enabled) continue;
            // Players who can't edit shouldn't see dice they can't pass
            if (!game.user.isGM && game.settings.get(MODULE_ID, 'playersCanPassBonuses') && !dieConfig.visibleToPlayers) continue;
            const targetSection = args[5];
            targetSection[key] = mkDie(key, ...args.slice(0, 5));
        }

        return { dice, symbols, showDecreaseButton };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find("button[data-action]").click(ev => {
            const btn = ev.currentTarget;
            const action = btn.dataset.action;
            const valSpan = btn.closest(".controls").querySelector(".value");
            let val = parseInt(valSpan.textContent);

            if (action === "increase") {
                val++;
            } else if (action === "decrease" && val > 0) {
                val--;
            }
            valSpan.textContent = val;
        });
    }

    async _updateObject(event, formData) {
        if (!canvas.scene) return;
        const isGM = game.user.isGM;

        // Collect the final values from the form
        const finalResources = {};
        for (const row of this.form.querySelectorAll(".resource-row")) {
            const key = row.querySelector("[data-key]")?.dataset.key;
            if (key) {
                const val = parseInt(row.querySelector(".value").textContent);
                if (val >= 0) {
                    finalResources[key] = val;
                }
            }
        }

        if (isGM) {
            // GM Mode: Replace the resources directly
            const allData = await getSceneTrackedActors(canvas.scene);
            if (!allData[this.actorId]) allData[this.actorId] = { resources: {} };
            
            // Clean up any zero-value keys before saving
            for (const key in finalResources) {
                if (finalResources[key] === 0) {
                    delete finalResources[key];
                }
            }
            allData[this.actorId].resources = finalResources;
            await canvas.scene.setFlag(MODULE_ID, "trackedActors", allData);

        } else {
            // Player Mode: Calculate the difference from the original state and send via socket.
            const changes = {};
            const allKeys = new Set([...Object.keys(this.originalResources), ...Object.keys(finalResources)]);

            for (const key of allKeys) {
                const originalVal = this.originalResources[key] || 0;
                const finalVal = finalResources[key] || 0;
                const diff = finalVal - originalVal;

                if (diff !== 0) {
                    changes[key] = diff;
                }
            }
            
            if (Object.keys(changes).length > 0) {
                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "addBonuses", // Use the existing socket handler which can now handle negative values
                    payload: {
                        sceneId: canvas.scene.id,
                        actorId: this.actorId,
                        resourcesToAdd: changes,
                    },
                });
                ui.notifications.info("Request to change bonuses sent to the GM.");
            }
        }
    }
}

// --- 4. The Dice Selector for Settings ---
export class DiceSelector extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-dice-selector",
            title: game.i18n.localize("FFGPartyBoost.Settings.DiceSelector.Title"),
            template: `modules/${MODULE_ID}/templates/dice-selector.html`,
            width: 450,
            height: "auto",
            classes: ["ffg-dice-selector-dialog"]
        });
    }

    getData() {
        const visibleDiceSettings = game.settings.get(MODULE_ID, "editorVisibleDice");
        const mkDie = (key, labelKey, type, char, css, isUpgrade = false) => {
            const dieConfig = visibleDiceSettings[key] || { enabled: true, visibleToPlayers: true };
            return { name: game.i18n.localize(labelKey), checked: dieConfig.enabled, visibleToPlayers: dieConfig.visibleToPlayers, type, css, char, isUpgrade };
        };
        return {
            bonusTypes: {
                dice: { label: "Dice", items: {
                    boost: mkDie("boost", "FFGPartyBoost.Editor.Dice.Boost", "starwars", "b", "boost"),
                    setback: mkDie("setback", "FFGPartyBoost.Editor.Dice.Setback", "starwars", "b", "setback"),
                    ability: mkDie("ability", "FFGPartyBoost.Editor.Dice.Ability", "starwars", "d", "ability"),
                    difficulty: mkDie("difficulty", "FFGPartyBoost.Editor.Dice.Difficulty", "starwars", "d", "difficulty"),
                    proficiency: mkDie("proficiency", "FFGPartyBoost.Editor.Dice.Proficiency", "starwars", "c", "proficiency"),
                    challenge: mkDie("challenge", "FFGPartyBoost.Editor.Dice.Challenge", "starwars", "c", "challenge"),
                    upgradeSkill: mkDie("upgradeSkill", "FFGPartyBoost.Editor.Dice.UpgradeSkill", "starwars", "c", "proficiency", true),
                    upgradeDifficulty: mkDie("upgradeDifficulty", "FFGPartyBoost.Editor.Dice.UpgradeDifficulty", "starwars", "c", "challenge", true),
                }},
                symbols: { label: "Symbols", items: {
                    success: mkDie("success", "FFGPartyBoost.Editor.Symbols.Success", "genesys", "s", "success"),
                    failure: mkDie("failure", "FFGPartyBoost.Editor.Symbols.Failure", "genesys", "f", "failure"),
                    advantage: mkDie("advantage", "FFGPartyBoost.Editor.Symbols.Advantage", "genesys", "a", "advantage"),
                    threat: mkDie("threat", "FFGPartyBoost.Editor.Symbols.Threat", "genesys", "h", "threat"),
                    triumph: mkDie("triumph", "FFGPartyBoost.Editor.Symbols.Triumph", "genesys", "t", "triumph"),
                    despair: mkDie("despair", "FFGPartyBoost.Editor.Symbols.Despair", "genesys", "d", "despair"),
                }}
            }
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('.visibility-toggle').click(ev => {
            const icon = ev.currentTarget.querySelector('i');
            const hiddenInput = ev.currentTarget.closest('label').querySelector('input[type="hidden"]');
            const isVisible = icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash', !isVisible);
            hiddenInput.value = isVisible;
        });
    }
    
    async _updateObject(event, formData) {
        const newSettings = {};
        for (const key of Object.keys(ALL_BONUS_TYPES)) {
            newSettings[key] = { enabled: formData[key] || false, visibleToPlayers: formData[`${key}-visible`] === 'true' };
        }
        await game.settings.set(MODULE_ID, "editorVisibleDice", newSettings);
    }
}

// --- 5. NEW: Transfer Actors Dialog ---
class TransferActorsDialog extends FormApplication {
    constructor(options = {}) {
        super(options);
        this.sourceActors = {};
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ffg-transfer-actors",
            title: "Transfer Actors from Scene",
            template: `modules/${MODULE_ID}/templates/transfer-actors.html`,
            width: 400,
            height: "auto",
        });
    }

    getData() {
        const scenes = game.scenes.filter(s => s.id !== canvas.scene?.id);
        return { scenes };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('select[name="sceneId"]').on('change', this._onSceneChange.bind(this));
    }

    async _onSceneChange(event) {
        const sceneId = event.currentTarget.value;
        const container = this.form.querySelector("#actor-list-container");
        const submitButton = this.form.querySelector('button[type="submit"]');
        
        if (!sceneId) {
            container.innerHTML = `<p class="notes">Please select a scene to see available actors.</p>`;
            this.sourceActors = {};
            submitButton.disabled = true;
            return;
        }

        const sourceScene = game.scenes.get(sceneId);
        this.sourceActors = await getSceneTrackedActors(sourceScene);
        
        let actorListHtml = '';
        const actorEntries = Object.entries(this.sourceActors);

        if (actorEntries.length === 0 || actorEntries.every(([key, val]) => Object.keys(val.resources || {}).length === 0)) {
            container.innerHTML = `<p class="notes">The selected scene has no actors with bonuses in its bonus bar.</p>`;
            submitButton.disabled = true;
            return;
        }
        
        // Handle generics first
        const generics = {
            'generic-pc': 'PC',
            'generic-npc': 'NPC'
        };
        for (const [id, name] of Object.entries(generics)) {
            if (this.sourceActors[id]) {
                actorListHtml += `
                    <div class="form-group">
                        <label class="checkbox">
                            <input type="checkbox" name="${id}" checked /> ${name}
                        </label>
                    </div>`;
            }
        }

        for (const [id, data] of actorEntries) {
            if (id.startsWith('generic-')) continue;
            const actor = game.actors.get(id);
            if (actor) {
                 actorListHtml += `
                    <div class="form-group">
                        <label class="checkbox">
                            <input type="checkbox" name="${id}" checked /> ${actor.name}
                        </label>
                    </div>`;
            }
        }
        
        container.innerHTML = actorListHtml;
        submitButton.disabled = false;
        this.setPosition(); // Recenter dialog
    }

    async _updateObject(event, formData) {
        if (!canvas.scene) return;

        const currentSceneActors = await getSceneTrackedActors(canvas.scene);
        
        for (const [id, isChecked] of Object.entries(formData)) {
            if (!isChecked || id === "sceneId") continue;

            // If the source has the actor, copy it over.
            if (this.sourceActors[id]) {
                currentSceneActors[id] = this.sourceActors[id];
            }
        }

        await canvas.scene.setFlag(MODULE_ID, "trackedActors", currentSceneActors);
        ui.notifications.info("Actor bonuses transferred successfully to the current scene.");
    }
}