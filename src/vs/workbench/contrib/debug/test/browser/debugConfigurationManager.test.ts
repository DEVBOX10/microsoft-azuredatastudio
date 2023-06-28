/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { FileService } from 'vs/platform/files/common/fileService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { NullLogService } from 'vs/platform/log/common/log';
import { UriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentityService';
import { ConfigurationManager } from 'vs/workbench/contrib/debug/browser/debugConfigurationManager';
import { DebugConfigurationProviderTriggerKind, IAdapterManager, IConfig, IDebugAdapterExecutable, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { TestHistoryService, TestQuickInputService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestContextService, TestExtensionService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { URI } from 'vs/base/common/uri';

suite.skip('debugConfigurationManager', () => {
	const configurationProviderType = 'custom-type';
	let _debugConfigurationManager: ConfigurationManager;
	const disposables = new DisposableStore();

	const adapterManager = <IAdapterManager>{
		getDebugAdapterDescriptor(session: IDebugSession, config: IConfig): Promise<IDebugAdapterExecutable | undefined> {
			return Promise.resolve(undefined);
		},

		activateDebuggers(activationEvent: string, debugType?: string): Promise<void> {
			return Promise.resolve();
		},

		get onDidDebuggersExtPointRead(): Event<void> {
			return Event.None;
		}
	};

	const preferencesService = <IPreferencesService>{
		userSettingsResource: URI.file('/tmp/settings.json')
	};

	const configurationService = new TestConfigurationService();
	setup(() => {
		const fileService = disposables.add(new FileService(new NullLogService()));
		_debugConfigurationManager = new ConfigurationManager(
			adapterManager,
			new TestContextService(),
			configurationService,
			new TestQuickInputService(),
			new TestInstantiationService(new ServiceCollection([IPreferencesService, preferencesService])),
			new TestStorageService(),
			new TestExtensionService(),
			new TestHistoryService(),
			new UriIdentityService(fileService),
			new ContextKeyService(configurationService));
	});

	test('resolves configuration based on type', async () => {
		disposables.add(_debugConfigurationManager.registerDebugConfigurationProvider({
			type: configurationProviderType,
			resolveDebugConfiguration: (folderUri, config, token) => {
				assert.strictEqual(config.type, configurationProviderType);
				return Promise.resolve({
					...config,
					configurationResolved: true
				});
			},
			triggerKind: DebugConfigurationProviderTriggerKind.Initial
		}));

		const initialConfig: IConfig = {
			type: configurationProviderType,
			request: 'launch',
			name: 'configName',
		};

		const resultConfig = await _debugConfigurationManager.resolveConfigurationByProviders(undefined, configurationProviderType, initialConfig, CancellationToken.None);
		assert.strictEqual((resultConfig as any).configurationResolved, true, 'Configuration should be updated by test provider');
	});

	test('resolves configuration from second provider if type changes', async () => {
		const secondProviderType = 'second-provider';
		disposables.add(_debugConfigurationManager.registerDebugConfigurationProvider({
			type: configurationProviderType,
			resolveDebugConfiguration: (folderUri, config, token) => {
				assert.strictEqual(config.type, configurationProviderType);
				return Promise.resolve({
					...config,
					type: secondProviderType
				});
			},
			triggerKind: DebugConfigurationProviderTriggerKind.Initial
		}));
		disposables.add(_debugConfigurationManager.registerDebugConfigurationProvider({
			type: secondProviderType,
			resolveDebugConfiguration: (folderUri, config, token) => {
				assert.strictEqual(config.type, secondProviderType);
				return Promise.resolve({
					...config,
					configurationResolved: true
				});
			},
			triggerKind: DebugConfigurationProviderTriggerKind.Initial
		}));

		const initialConfig: IConfig = {
			type: configurationProviderType,
			request: 'launch',
			name: 'configName',
		};

		const resultConfig = await _debugConfigurationManager.resolveConfigurationByProviders(undefined, configurationProviderType, initialConfig, CancellationToken.None);
		assert.strictEqual(resultConfig!.type, secondProviderType);
		assert.strictEqual((resultConfig as any).configurationResolved, true, 'Configuration should be updated by test provider');
	});

	teardown(() => disposables.clear());
});
