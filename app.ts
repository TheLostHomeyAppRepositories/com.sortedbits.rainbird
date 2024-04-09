'use strict';

import Homey from 'homey';
import { ArgumentAutocompleteResults } from 'homey/lib/FlowCard';

class MyApp extends Homey.App {
    /**
     * onInit is called when the app is initialized.
     */
    async onInit() {
        this.log('MyApp has been initialized');

        const startZoneAction = this.homey.flow.getActionCard('start_zone');
        this.registerZoneAutocomplete(startZoneAction);

        const zoneWithTime = this.homey.flow.getActionCard('start_zone_X_minutes');
        this.registerZoneAutocomplete(zoneWithTime);

        const stopZoneAction = this.homey.flow.getActionCard('stop_zone');
        this.registerZoneAutocomplete(stopZoneAction);

        const zoneIsActive = this.homey.flow.getConditionCard('zone_is_active');
        this.registerZoneAutocomplete(zoneIsActive);

        await this.discoveryTest();
    }

    discoveryTest = async () => {
        const discoveryStrategy = this.homey.discovery.getStrategy('rainbird');
        this.log('discoveryStrategy', discoveryStrategy);

        const initialDiscoveryResults = discoveryStrategy.getDiscoveryResults();
        for (const discoveryResult of Object.values(initialDiscoveryResults)) {
            this.handleDiscoveryResult(discoveryResult);
        }

        discoveryStrategy.on('result', (discoveryResult) => {
            this.handleDiscoveryResult(discoveryResult);
        });
    };

    handleDiscoveryResult(discoveryResult) {
        this.log('Got result:', discoveryResult);
    }

    private registerZoneAutocomplete(card: Homey.FlowCardAction) {
        card.registerArgumentAutocompleteListener('zone', async (query, args): Promise<ArgumentAutocompleteResults> => {
            const device = args.device as Homey.Device;

            const { zones } = device.getSettings();
            const filtered = zones.filter((z) => z.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

            return filtered.map((z) => {
                return {
                    name: z.name,
                    index: z.index,
                };
            });
        });
    }
}

module.exports = MyApp;
