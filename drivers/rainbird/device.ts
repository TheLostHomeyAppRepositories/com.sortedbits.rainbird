import Homey from 'homey';
import { Zone } from './models/zone';

class RainbirdDevice extends Homey.Device {
    rainbirdService: any | undefined;
    zones: Zone[] = [];
    endTime: Date | undefined = undefined;
    cancelLoop: boolean = true;
    isActiveCard!: Homey.FlowCardTriggerDevice;
    enableQueueing: boolean = false;
    timeoutId: NodeJS.Timeout | undefined;

    getCurrentZoneId = (): number | undefined => {
        const zones = this.rainbirdService?.zones;

        for (const zone of zones ?? []) {
            if (this.rainbirdService?.isActive(zone)) {
                return zone;
            }
        }

        return undefined;
    };

    async updateRainSetPoint() {
        const rainSetPointReached = this.rainbirdService.rainSetPointReached ?? false;

        if (this.getCapabilityValue('rain_set_point_reached') !== rainSetPointReached) {
            const trigger = this.homey.flow.getDeviceTriggerCard('rain_set_point_changed');
            await trigger.trigger(this);

            if (rainSetPointReached) {
                await this.homey.flow.getDeviceTriggerCard('rain_set_point_reached').trigger(this);
            }
        }

        await this.setCapabilityValue('rain_set_point_reached', rainSetPointReached);
    }

    async getCurrentStatus(initial: boolean = false) {
        if (!this.rainbirdService) {
            return;
        }

        const isInUse = this.rainbirdService.isInUse() ?? false;
        const currentZoneId = this.getCurrentZoneId();

        this.log('Getting status', isInUse, currentZoneId, this.getCapabilityValue('is_active'));

        if (!initial && isInUse !== this.getCapabilityValue('is_active')) {
            const card = isInUse ? 'turns_on' : 'turns_off';

            const trigger = this.homey.flow.getDeviceTriggerCard(card);
            await trigger.trigger(this);
        }

        await this.setCapabilityValue('is_active', isInUse);

        await this.updateRainSetPoint();

        if (currentZoneId) {
            const zone = this.zones.find((z) => z.index === currentZoneId);
            if (zone) {
                await this.setCapabilityValue('active_zone', zone.name);
            } else {
                await this.setCapabilityValue('active_zone', 'Unknown');
            }

            const duration = this.rainbirdService?.remainingDuration(currentZoneId) ?? 0;

            if (duration) {
                const endDate = new Date(Date.now() + 1000 * duration);
                this.endTime = endDate;
                if (this.cancelLoop) {
                    this.cancelLoop = false;
                    await this.updateTime();
                }
            } else {
                await this.setCapabilityValue('zone_time_left', '-');
                this.cancelLoop = true;
            }
        } else {
            this.endTime = undefined;
            this.cancelLoop = true;
            await this.setCapabilityValue('active_zone', 'None');
            await this.setCapabilityValue('zone_time_left', '-');
        }
    }

    async instantiateController() {
        const { zones, host, password, debug, enableQueueing, defaultIrrigationTime, zonesAvailable } = this.getSettings();

        this.zones = zones;
        this.log('Getting configured zones', this.zones);

        // eslint-disable-next-line node/no-unsupported-features/es-syntax
        const serviceType = await import('rainbird/dist/RainBird/RainBirdService.js');
        this.log('Imported RainBirdService');

        // Your code that uses RainBirdService goes here
        const { RainBirdService } = serviceType;

        this.rainbirdService = new RainBirdService({
            address: host,
            password,
            syncTime: true,
            showRequestResponse: debug ?? false,
            refreshRate: 30,
        });

        this.log('RainbirdService created');

        const metadata = await this.rainbirdService?.init();

        if (enableQueueing === 'on') {
            await this.setSettings({ enableQueueing: false });
        }

        if (typeof defaultIrrigationTime === 'string') {
            await this.setSettings({ defaultIrrigationTime: 60 });
        }

        if (!zonesAvailable && metadata.zones) {
            await this.setSettings({
                zonesAvailable: metadata.zones.length,
            });
        }

        await this.getCurrentStatus(true);

        this.rainbirdService.on('status', () => {
            this.getCurrentStatus().catch((e) => this.error(e));
        });

        this.rainbirdService.on('rain_sensor_state', async () => {
            this.log('Rain sensor state changed');

            await this.updateRainSetPoint();
        });
    }

    /**
     * onInit is called when the device is initialized.
     */
    async onInit() {
        this.log('RainbirdDevice has been initialized');

        if (!this.hasCapability('rain_set_point_reached')) {
            await this.addCapability('rain_set_point_reached');
        }

        await this.instantiateController();
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('RainbirdDevice has been added');
    }

    /**
     * onSettings is called when the user updates the device's settings.
     * @param {object} event the onSettings event data
     * @param {object} event.oldSettings The old settings object
     * @param {object} event.newSettings The new settings object
     * @param {string[]} event.changedKeys An array of keys changed since the previous version
     * @returns {Promise<string|void>} return a custom message that will be displayed
     */
    async onSettings({
        oldSettings,
        newSettings,
        changedKeys,
    }: {
        oldSettings: {
            [key: string]: boolean | string | number | undefined | null;
        };
        newSettings: { [key: string]: boolean | string | number | undefined | null };
        changedKeys: string[];
    }): Promise<string | void> {
        this.log('RainbirdDevice settings where changed');

        if (this.timeoutId) {
            this.homey.clearTimeout(this.timeoutId);
        }

        this.rainbirdService?.deactivateAllZones();

        await this.rainbirdService?.stopIrrigation();
        await this.instantiateController();
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name: string) {
        this.log('RainbirdDevice was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted() {
        this.log('RainbirdDevice has been deleted');

        this.cancelLoop = true;
        if (this.timeoutId) {
            this.homey.clearTimeout(this.timeoutId);
        }

        this.rainbirdService?.deactivateAllZones();
        await this.rainbirdService?.stopIrrigation();
    }

    updateTime = async () => {
        const now = Date.now();

        if (this.endTime) {
            if (now > this.endTime.getTime()) {
                await this.setCapabilityValue('zone_time_left', '-');
                this.cancelLoop = true;
            } else {
                const remaining = (this.endTime.getTime() - now) / 1000;
                await this.setCapabilityValue('zone_time_left', this.formatTime(remaining));
            }
        } else {
            await this.setCapabilityValue('zone_time_left', '-');
        }

        if (!this.cancelLoop) {
            this.timeoutId = await this.homey.setTimeout(this.updateTime.bind(this), 1000 - (now % 1000));
        }
    };

    public rainbirdIsActive = async (): Promise<boolean> => {
        return this.rainbirdService?.isInUse();
    };

    public rainSetPointActive = async (): Promise<boolean> => {
        return this.rainbirdService?.rainSetPointReached ?? false;
    };

    public zoneIsActive = async (args: any) => {
        if (args.zone) {
            return this.rainbirdService?.isInUse(args.zone.index);
        }
        return false;
    };

    public startZoneWithTime = async (args: any) => {
        const { zone, minutes } = args;

        if (zone && minutes) {
            if (!this.enableQueueing) {
                this.log('No queueing, disabling active zones before starting new one');
                this.rainbirdService?.deactivateAllZones();
                await this.rainbirdService?.stopIrrigation();
                this.log(`Starting zone ${zone.name} (${zone.index}) for ${minutes} minutes`);
            } else {
                this.log(`Queueing zone ${zone.name} (${zone.index}) for ${minutes} minutes`);
            }

            this.rainbirdService?.activateZone(zone.index, minutes * 60);
        }
    };

    public startZone = async (args: any) => {
        const { zone } = args;

        const minutes = this.getSetting('defaultIrrigationTime');

        if (zone) {
            if (!this.enableQueueing) {
                this.log('No queueing, disabling active zones before starting new one');
                this.rainbirdService?.deactivateAllZones();
                await this.rainbirdService?.stopIrrigation();
                this.log(`Starting zone ${zone.name} (${zone.index}) for ${minutes} minutes`);
            } else {
                this.log(`Queueing zone ${zone.name} (${zone.index}) for ${minutes} minutes`);
            }

            this.rainbirdService?.activateZone(zone.index, minutes * 60);
        }
    };

    public stopZone = async (args: any) => {
        const { zone } = args;

        if (zone) {
            this.log(`Stopping zone ${zone.name}`);

            this.rainbirdService?.deactivateZone(zone.index).catch((e) => this.error(e));
        }
    };

    public stopIrrigation = async () => {
        this.rainbirdService?.deactivateAllZones();
        this.rainbirdService?.stopIrrigation().catch((e) => this.error(e));
    };

    private formatTime(seconds?: number): string {
        if (seconds === undefined) {
            return '-';
        }
        const date = new Date(seconds * 1000);
        return date.toISOString().substring(11, 19);
    }
}

module.exports = RainbirdDevice;
