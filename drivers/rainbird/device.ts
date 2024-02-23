import Homey from 'homey';
import { ArgumentAutocompleteResults } from 'homey/lib/FlowCard';

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
  }

  async getCurrentStatus(initial: boolean = false) {
    const isInUse = this.rainbirdService?.isInUse() ?? false;
    const currentZoneId = this.getCurrentZoneId();

    if (!initial && isInUse !== this.getCapabilityValue('is_active')) {
      const card = isInUse ? 'turns_on' : 'turns_off';

      const trigger = this.homey.flow.getDeviceTriggerCard(card);
      await trigger.trigger(this);
    }

    await this.setCapabilityValue('is_active', isInUse);

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
    const {
      zones,
      host,
      password,
      debug,
      enableQueueing,
      defaultIrrigationTime,
      zonesAvailable,
    } = this.getSettings();

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
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('RainbirdDevice has been initialized');

    this.isActiveCard = this.homey.flow.getDeviceTriggerCard('turns_on');

    const zoneWithTime = this.homey.flow.getActionCard('start_zone_X_minutes');
    this.registerZoneAutocomplete(zoneWithTime);
    this.registerRunListenerStartZoneWithTime(zoneWithTime);

    const startZoneAction = this.homey.flow.getActionCard('start_zone');
    this.registerZoneAutocomplete(startZoneAction);
    this.registerRunListenerStartZone(startZoneAction);

    const stopZoneAction = this.homey.flow.getActionCard('stop_zone');
    this.registerZoneAutocomplete(stopZoneAction);
    this.registerRunListenerStopZone(stopZoneAction);

    const stopIrrigationAction = this.homey.flow.getActionCard('stop_irrigation');
    this.registerRunListenerStopIrrigation(stopIrrigationAction);

    const zoneIsActive = this.homey.flow.getConditionCard('zone_is_active');
    this.registerZoneAutocomplete(zoneIsActive);

    zoneIsActive.registerRunListener(async (args) => {
      if (args.zone) {
        return this.rainbirdService?.isInUse(args.zone.index);
      }
      return false;
    });

    const rainbirdIsActive = this.homey.flow.getConditionCard('rainbird_is_active');
    rainbirdIsActive.registerRunListener(async (args) => {
      return this.rainbirdService?.isInUse();
    });

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
      [key: string]: boolean | string | number | undefined | null
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
  }

  private registerZoneAutocomplete(card: Homey.FlowCardAction) {
    card.registerArgumentAutocompleteListener(
      'zone',
      async (query, args): Promise<ArgumentAutocompleteResults> => {
        const { zones } = this.getSettings();
        const filtered = zones.filter((z) => z.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

        return filtered.map((z) => {
          return {
            name: z.name,
            index: z.index,
          };
        });
      },
    );
  }

  private registerRunListenerStartZoneWithTime(card: Homey.FlowCardAction) {
    card.registerRunListener(async (args) => {
      const { zone } = args;
      const { minutes } = args;

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
    });
  }

  private registerRunListenerStartZone(card: Homey.FlowCardAction) {
    card.registerRunListener(async (args) => {
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
    });
  }

  private registerRunListenerStopZone(card: Homey.FlowCardAction) {
    card.registerRunListener(async (args) => {
      const { zone } = args;

      if (zone) {
        this.log(`Stopping zone ${zone.name}`);

        this.rainbirdService?.deactivateZone(zone.index).catch((e) => this.error(e));
      }
    });
  }

  private registerRunListenerStopIrrigation(card: Homey.FlowCardAction) {
    card.registerRunListener(async () => {
      this.rainbirdService?.deactivateAllZones();

      this.rainbirdService?.stopIrrigation().catch((e) => this.error(e));
    });
  }

  private formatTime(seconds?: number): string {
    if (seconds === undefined) {
      return '-';
    }
    const date = new Date(seconds * 1000);
    return date.toISOString().substring(11, 19);
  }

}

module.exports = RainbirdDevice;
