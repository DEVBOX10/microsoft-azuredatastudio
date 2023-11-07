"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameVscodeLangpacks = exports.refreshLangpacks = exports.modifyI18nPackFiles = exports.packageSingleExtensionStream = exports.packageLangpacksStream = void 0;
const es = require("event-stream");
const path = require("path");
const glob = require("glob");
const rename = require("gulp-rename");
const ext = require("./extensions");
const i18n = require("./i18n");
const fs = require("fs");
const File = require("vinyl");
const rimraf = require("rimraf");
const gulp = require("gulp");
const vfs = require("vinyl-fs");
/**
 * If you need to compile this file for any changes, please run: yarn tsc -p ./build/tsconfig.json
 */
const root = path.dirname(path.dirname(__dirname));
// Modified packageLocalExtensionsStream from extensions.ts, but for langpacks.
function packageLangpacksStream() {
    const langpackDescriptions = glob.sync('i18n/*/package.json')
        .map(manifestPath => {
        const langpackPath = path.dirname(path.join(root, manifestPath));
        const langpackName = path.basename(langpackPath);
        return { name: langpackName, path: langpackPath };
    });
    const builtLangpacks = langpackDescriptions.map(langpack => {
        return ext.fromLocalNormal(langpack.path)
            .pipe(rename(p => p.dirname = `langpacks/${langpack.name}/${p.dirname}`));
    });
    return es.merge(builtLangpacks);
}
exports.packageLangpacksStream = packageLangpacksStream;
// Modified packageLocalExtensionsStream but for any ADS extensions including excluded/external ones.
function packageSingleExtensionStream(name) {
    const extenalExtensionDescriptions = glob.sync(`extensions/${name}/package.json`)
        .map(manifestPath => {
        const extensionPath = path.dirname(path.join(root, manifestPath));
        const extensionName = path.basename(extensionPath);
        return { name: extensionName, path: extensionPath };
    });
    const builtExtension = extenalExtensionDescriptions.map(extension => {
        return ext.fromLocal(extension.path, false, true)
            .pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
    });
    return es.merge(builtExtension);
}
exports.packageSingleExtensionStream = packageSingleExtensionStream;
// Langpack creation functions go here.
/**
 * Function combines the contents of the SQL core XLF file into the current main i18n file contianing the vs core strings.
 * Based on createI18nFile in i18n.ts
*/
function updateMainI18nFile(existingTranslationFilePath, originalFilePath, messages) {
    let currFilePath = path.join(existingTranslationFilePath + '.i18n.json');
    let currentContent = fs.readFileSync(currFilePath);
    let currentContentObject = JSON.parse(currentContent.toString());
    let objectContents = currentContentObject.contents;
    let result = Object.create(null);
    // Delete any SQL strings that are no longer part of ADS in current langpack.
    for (let contentKey of Object.keys(objectContents)) {
        if (contentKey.startsWith('sql') && messages.contents[contentKey] === undefined) {
            delete objectContents[`${contentKey}`];
        }
    }
    messages.contents = { ...objectContents, ...messages.contents };
    result[''] = [
        '--------------------------------------------------------------------------------------------',
        'Copyright (c) Microsoft Corporation. All rights reserved.',
        'Licensed under the MIT License. See License.txt in the project root for license information.',
        '--------------------------------------------------------------------------------------------',
        'Do not edit this file. It is machine generated.'
    ];
    for (let key of Object.keys(messages)) {
        result[key] = messages[key];
    }
    let content = JSON.stringify(result, null, '\t');
    if (process.platform === 'win32') {
        content = content.replace(/\n/g, '\r\n');
    }
    return new File({
        path: path.join(originalFilePath + '.i18n.json'),
        contents: Buffer.from(content, 'utf8'),
    });
}
/**
 * Function handles the processing of xlf resources and turning them into i18n.json files.
 * It adds the i18n files translation paths to be added back into package.main.
 * Based on prepareI18nPackFiles in i18n.ts
*/
function modifyI18nPackFiles(existingTranslationFolder, resultingTranslationPaths, pseudo = false) {
    let parsePromises = [];
    let mainPack = { version: i18n.i18nPackVersion, contents: {} };
    let extensionsPacks = {};
    let errors = [];
    return es.through(function (xlf) {
        let rawResource = path.basename(xlf.relative, '.xlf');
        let resource = rawResource.substring(0, rawResource.lastIndexOf('.'));
        let contents = xlf.contents.toString();
        let parsePromise = pseudo ? i18n.XLF.parsePseudo(contents) : i18n.XLF.org_parse(contents);
        parsePromises.push(parsePromise);
        parsePromise.then(resolvedFiles => {
            resolvedFiles.forEach(file => {
                const path = file.originalFilePath;
                const firstSlash = path.indexOf('/');
                //exclude core sql file from extension processing.
                if (resource !== 'sql') {
                    let extPack = extensionsPacks[resource];
                    if (!extPack) {
                        extPack = extensionsPacks[resource] = { version: i18n.i18nPackVersion, contents: {} };
                    }
                    //remove extensions/extensionId section as all extensions will be webpacked.
                    const secondSlash = path.indexOf('/', firstSlash + 1);
                    extPack.contents[path.substr(secondSlash + 1)] = file.messages;
                }
                else {
                    mainPack.contents[path.substr(firstSlash + 1)] = file.messages;
                }
            });
        }).catch(reason => {
            errors.push(reason);
        });
    }, function () {
        Promise.all(parsePromises)
            .then(() => {
            if (errors.length > 0) {
                throw errors;
            }
            const translatedMainFile = updateMainI18nFile(existingTranslationFolder + '\\main', './main', mainPack);
            this.queue(translatedMainFile);
            for (let extension in extensionsPacks) {
                const translatedExtFile = i18n.createI18nFile(`extensions/${extension}`, extensionsPacks[extension]);
                this.queue(translatedExtFile);
                resultingTranslationPaths.push({ id: extension, resourceName: `extensions/${extension}.i18n.json` });
            }
            this.queue(null);
        })
            .catch((reason) => {
            this.emit('error', reason);
        });
    });
}
exports.modifyI18nPackFiles = modifyI18nPackFiles;
const textFields = {
    "nameText": 'ads',
    "displayNameText": 'Azure Data Studio',
    "publisherText": 'Microsoft',
    "licenseText": 'SEE MIT License IN LICENSE.txt',
    "updateText": 'cd ../vscode && npm run update-localization-extension ',
    "vscodeVersion": '*',
    "azdataVersion": '^1.47.0',
    "gitUrl": 'https://github.com/Microsoft/azuredatastudio'
};
//list of extensions from vscode that are to be included with ADS.
const VSCODEExtensions = [
    "bat",
    "builtin-notebook-renderers",
    "configuration-editing",
    "docker",
    "git-base",
    "github",
    "github-authentication",
    "ipynb",
    "javascript",
    "json",
    "json-language-features",
    "markdown",
    "markdown-language-features",
    "markdown-math",
    "media-preview",
    "merge-conflict",
    "microsoft-authentication",
    "powershell",
    "python",
    "r",
    "search-result",
    "simple-browser",
    "sql",
    "theme-abyss",
    "theme-defaults",
    "theme-kimbie-dark",
    "theme-monokai",
    "theme-monokai-dimmed",
    "theme-quietlight",
    "theme-red",
    "vscode-theme-seti",
    "theme-solarized-dark",
    "theme-solarized-light",
    "theme-tomorrow-night-blue",
    "xml",
    "yaml"
];
/**
 * A heavily modified version of update-localization-extension that runs using local xlf resources, no arguments required to pass in.
 * It converts a renamed vscode langpack to an ADS one or updates the existing langpack to use current XLF resources.
 * It runs this process on all langpacks currently in the ADS i18n folder.
 * (Replace an individual ADS langpack folder with a corresponding vscode langpack folder renamed to "ads" instead of "vscode"
 * in order to update vscode core strings and extensions for that langpack)
 *
 * It removes the resources of vscode that we do not support, and adds in new i18n json files created from the xlf files in the folder.
 * It also merges in the sql core XLF strings with the langpack's existing core strings into a combined main i18n json file.
 *
 * After running this gulp task, for each language pack:
 *
 * 1. Remember to change the version of the langpacks to continue from the previous version of the ADS langpack.
 *
 * 2. Also change the azdata version to match the current ADS version number.
 *
 * 3. Update the changelog with the new version of the language pack.
 *
 * IMPORTANT: If you have run this gulp task on langpacks that originated from vscode, for each affected vscode langpack, you must
 * replace the changelog and readme files with the ones from the previous ADS version of the langpack before doing the above steps.
 *
 * This is mainly for consistency with previous langpacks and to provide proper information to the user.
*/
function refreshLangpacks() {
    let supportedLocations = [...i18n.defaultLanguages, ...i18n.extraLanguages];
    for (let i = 0; i < supportedLocations.length; i++) {
        let langId = supportedLocations[i].id;
        if (langId === "zh-cn") {
            langId = "zh-hans";
        }
        if (langId === "zh-tw") {
            langId = "zh-hant";
        }
        let location = path.join('.', 'resources', 'xlf');
        let locExtFolder = path.join('.', 'i18n', `ads-language-pack-${langId}`);
        try {
            fs.statSync(locExtFolder);
        }
        catch {
            console.log('Language is not included in ADS yet: ' + langId);
            continue;
        }
        let packageJSON = JSON.parse(fs.readFileSync(path.join(locExtFolder, 'package.json')).toString());
        //processing extension fields, version and folder name must be changed manually.
        packageJSON['name'] = packageJSON['name'].replace('vscode', textFields.nameText).toLowerCase();
        packageJSON['displayName'] = packageJSON['displayName'].replace('Visual Studio Code', textFields.displayNameText);
        packageJSON['publisher'] = textFields.publisherText;
        packageJSON['license'] = textFields.licenseText;
        packageJSON['scripts']['update'] = textFields.updateText + langId;
        packageJSON['engines']['vscode'] = textFields.vscodeVersion;
        packageJSON['repository']['url'] = textFields.gitUrl;
        packageJSON['engines']['azdata'] = textFields.azdataVersion;
        let contributes = packageJSON['contributes'];
        if (!contributes) {
            throw new Error('The extension must define a "localizations" contribution in the "package.json"');
        }
        let localizations = contributes['localizations'];
        if (!localizations) {
            throw new Error('The extension must define a "localizations" contribution of type array in the "package.json"');
        }
        localizations.forEach(function (localization) {
            if (!localization.languageId || !localization.languageName || !localization.localizedLanguageName) {
                throw new Error('Each localization contribution must define "languageId", "languageName" and "localizedLanguageName" properties.');
            }
            let languageId = localization.transifexId || localization.languageId;
            let translationDataFolder = path.join(locExtFolder, 'translations');
            if (languageId === "zh-cn") {
                languageId = "zh-hans";
            }
            if (languageId === "zh-tw") {
                languageId = "zh-hant";
            }
            console.log(`Importing translations for ${languageId} from '${location}' to '${translationDataFolder}' ...`);
            let translationPaths = [];
            gulp.src(path.join(location, languageId, '**', '*.xlf'))
                .pipe(modifyI18nPackFiles(translationDataFolder, translationPaths, languageId === 'ps'))
                .on('error', (error) => {
                console.log(`Error occurred while importing translations:`);
                translationPaths = undefined;
                if (Array.isArray(error)) {
                    error.forEach(console.log);
                }
                else if (error) {
                    console.log(error);
                }
                else {
                    console.log('Unknown error');
                }
            })
                .pipe(vfs.dest(translationDataFolder))
                .on('end', function () {
                if (translationPaths !== undefined) {
                    let nonExistantExtensions = [];
                    for (let curr of localization.translations) {
                        try {
                            fs.statSync(path.join(translationDataFolder, curr.path.replace('./translations', '')));
                        }
                        catch {
                            nonExistantExtensions.push(curr);
                        }
                    }
                    for (let nonExt of nonExistantExtensions) {
                        let index = localization.translations.indexOf(nonExt);
                        if (index > -1) {
                            localization.translations.splice(index, 1);
                        }
                    }
                    for (let tp of translationPaths) {
                        let finalPath = `./translations/${tp.resourceName}`;
                        let isFound = false;
                        for (let i = 0; i < localization.translations.length; i++) {
                            if (localization.translations[i].path === finalPath) {
                                localization.translations[i].id = tp.id;
                                isFound = true;
                                break;
                            }
                        }
                        if (!isFound) {
                            localization.translations.push({ id: tp.id, path: finalPath });
                        }
                    }
                    fs.writeFileSync(path.join(locExtFolder, 'package.json'), JSON.stringify(packageJSON, null, '\t'));
                }
            });
        });
    }
    console.log("Langpack Refresh Completed.");
    return Promise.resolve();
}
exports.refreshLangpacks = refreshLangpacks;
/**
 * Function for adding replacing ads language packs with vscode ones.
 * For new languages, remember to add to i18n.extraLanguages so that it will be recognized by ADS.
*/
function renameVscodeLangpacks() {
    let supportedLocations = [...i18n.defaultLanguages, ...i18n.extraLanguages];
    for (let i = 0; i < supportedLocations.length; i++) {
        let langId = supportedLocations[i].id;
        if (langId === "zh-cn") {
            langId = "zh-hans";
        }
        if (langId === "zh-tw") {
            langId = "zh-hant";
        }
        let locADSFolder = path.join('.', 'i18n', `ads-language-pack-${langId}`);
        let locVSCODEFolder = path.join('.', 'i18n', `vscode-language-pack-${langId}`);
        let translationDataFolder = path.join(locVSCODEFolder, 'translations');
        let xlfFolder = path.join('.', 'resources', 'xlf');
        try {
            fs.statSync(locVSCODEFolder);
        }
        catch {
            console.log('vscode pack is not in ADS yet: ' + langId);
            continue;
        }
        //Delete any erroneous zip files found in vscode folder.
        let globZipArray = glob.sync(path.join(locVSCODEFolder, '*.zip'));
        globZipArray.forEach(element => {
            fs.unlinkSync(element);
        });
        // Delete extension files in vscode language pack that are not in ADS.
        if (fs.existsSync(translationDataFolder)) {
            let totalExtensions = fs.readdirSync(path.join(translationDataFolder, 'extensions'));
            for (let extensionTag in totalExtensions) {
                let extensionFileName = totalExtensions[extensionTag];
                let shortExtensionFileName = extensionFileName.replace('ms-vscode.', 'vscode.').replace('vscode.', '');
                let xlfPath = path.join(xlfFolder, `${langId}`, shortExtensionFileName.replace('.i18n.json', '.xlf'));
                if (!(fs.existsSync(xlfPath) || VSCODEExtensions.indexOf(shortExtensionFileName.replace('.i18n.json', '')) !== -1)) {
                    let filePath = path.join(translationDataFolder, 'extensions', extensionFileName);
                    rimraf.sync(filePath);
                }
            }
        }
        //Get list of md files in ADS langpack, to copy to vscode langpack prior to renaming.
        let globMDArray = glob.sync(path.join(locADSFolder, '*.md'));
        //Copy MD files to vscode langpack.
        globMDArray.forEach(element => {
            fs.copyFileSync(element, path.join(locVSCODEFolder, path.parse(element).base));
        });
        //Copy yarn.lock (required for packaging task)
        let yarnLockPath = path.join(locADSFolder, 'yarn.lock');
        if (fs.existsSync(yarnLockPath)) {
            fs.copyFileSync(yarnLockPath, path.join(locVSCODEFolder, 'yarn.lock'));
        }
        //remove the ADS langpack, and finally rename the vscode langpack to match the ADS one.
        rimraf.sync(locADSFolder);
        fs.renameSync(locVSCODEFolder, locADSFolder);
    }
    console.log("Langpack Rename Completed.");
    return Promise.resolve();
}
exports.renameVscodeLangpacks = renameVscodeLangpacks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jRnVuYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImxvY0Z1bmMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Z0dBR2dHOzs7QUFFaEcsbUNBQW1DO0FBQ25DLDZCQUE2QjtBQUM3Qiw2QkFBNkI7QUFDN0Isc0NBQXVDO0FBQ3ZDLG9DQUFxQztBQUNyQywrQkFBZ0M7QUFDaEMseUJBQXlCO0FBQ3pCLDhCQUE4QjtBQUM5QixpQ0FBaUM7QUFDakMsNkJBQTZCO0FBQzdCLGdDQUFnQztBQUVoQzs7R0FFRztBQUVILE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0FBRW5ELCtFQUErRTtBQUMvRSxTQUFnQixzQkFBc0I7SUFDckMsTUFBTSxvQkFBb0IsR0FBYyxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFFO1NBQ3ZFLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRTtRQUNuQixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7UUFDakUsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNqRCxPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLENBQUM7SUFDbkQsQ0FBQyxDQUFDLENBQUM7SUFFSixNQUFNLGNBQWMsR0FBRyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUU7UUFDMUQsT0FBTyxHQUFHLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7YUFDdkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLEdBQUcsYUFBYSxRQUFRLENBQUMsSUFBSSxJQUFJLENBQUMs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