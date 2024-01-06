import Homey from 'homey';
import { ArgumentAutocompleteResults } from 'homey/lib/FlowCard';
import { RainBirdService } from '../../RainBird/RainBirdService';
import { Zone } from './zone';

class RainbirdDevice extends Homey.Device {
  rainbirdService: RainBirdService | undefined;
  zones: Zone[] = [];
  endTime: Date | undefined = undefined;
  cancelLoop: boolean = true;
  isActiveCard!: Homey.FlowCardTriggerDevice;
  enableQueueing: boolean = false;

  async getCurrentStatus(initial: boolean = false) {
    const isInUse = this.rainbirdService?.isInUse() ?? false;

    if (!initial && isInUse !== this.getCapabilityValue('is_active')) {
      const card = isInUse ? 'turns_on' : 'turns_off';

      const trigger = this.homey.flow.getDeviceTriggerCard(card);
      await trigger.trigger(this);
    }

    this.setCapabilityValue("is_active", isInUse);

    if (this.rainbirdService?.currentZoneId) {
      const zone = this.zones.find(z => z.index === this.rainbirdService?.currentZoneId);
      if (zone) {
        this.setCapabilityValue('active_zone', zone.name);
      } else {
        this.setCapabilityValue('active_zone', 'Unknown');
      }

      const duration = this.rainbirdService.currentZoneRemainingDuration;

      if (duration) {
        const endDate = new Date(Date.now() + 1000 * duration);
        this.endTime = endDate;
        if (this.cancelLoop) {
          this.cancelLoop = false;
          this.updateTime();
        }
      } else {
        this.setCapabilityValue('zone_time_left', '-');
        this.cancelLoop = true;
      }
    } else {
      this.endTime = undefined;
      this.cancelLoop = true;
      this.setCapabilityValue('active_zone', 'None');
      this.setCapabilityValue('zone_time_left', '-');
    }
  }

  async instantiateController() {
    this.zones = this.getSetting('zones');

    this.rainbirdService = new RainBirdService({
      address: this.getSetting('host'),
      password: this.getSetting('password'),
      log: this,
      syncTime: true,
      showRequestResponse: this.getSetting('debug') ?? false,
      refreshRate: 30
    });

    const metadata = await this.rainbirdService?.init();
    this.log('Metadata', metadata);

    this.getCurrentStatus(true);

    this.rainbirdService.on('status', () => {
      this.getCurrentStatus();
    });
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('RainbirdDevice has been initialized');

    this.isActiveCard = this.homey.flow.getDeviceTriggerCard("turns_on");

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
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("RainbirdDevice settings where changed");

    this.rainbirdService?.deactivateAllZones();
    this.rainbirdService?.stopIrrigation();

    this.instantiateController();
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
    this.rainbirdService?.deactivateAllZones();
    this.rainbirdService?.stopIrrigation();
    this.cancelLoop = true;
  }

  private updateTime() {
    const now = Date.now();

    if (this.endTime) {
      if (now > this.endTime.getTime()) {
        this.setCapabilityValue('zone_time_left', '-');
        this.cancelLoop = true;
      } else {
        const remaining = (this.endTime.getTime() - now) / 1000;
        this.setCapabilityValue('zone_time_left', this.formatTime(remaining));
      }
    } else {
      this.setCapabilityValue('zone_time_left', '-');
    }

    if (!this.cancelLoop) {
      setTimeout(() => this.updateTime(), 1000 - (now % 1000));
    }
  }

  private registerZoneAutocomplete(card: Homey.FlowCardAction) {
    card.registerArgumentAutocompleteListener(
      "zone",
      async (query, args): Promise<ArgumentAutocompleteResults> => {
        const filtered = this.zones.filter(z => z.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

        return filtered.map(z => {
          return {
            name: z.name,
            index: z.index
          }
        })
      }
    )
  }

  private registerRunListenerStartZoneWithTime(card: Homey.FlowCardAction) {
    card.registerRunListener(async (args) => {
      const zone: Zone | undefined = args.zone;
      const minutes: number | undefined = args.minutes;

      if (zone && minutes) {
        if (!this.enableQueueing) {
          this.log(`No queueing, disabling active zones before starting new one`);
          this.rainbirdService?.deactivateAllZones();
          this.rainbirdService?.stopIrrigation();
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
      const zone: Zone | undefined = args.zone;

      const minutes = this.getSetting('defaultIrrigationTime');

      if (zone) {
        if (!this.enableQueueing) {
          this.log(`No queueing, disabling active zones before starting new one`);
          this.rainbirdService?.deactivateAllZones();
          this.rainbirdService?.stopIrrigation();
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
      const zone: Zone | undefined = args.zone;

      if (zone) {
        this.log(`Stopping zone ${zone.name}`);
        this.rainbirdService?.deactivateZone(zone.index);
      }
    });
  }

  private registerRunListenerStopIrrigation(card: Homey.FlowCardAction) {
    card.registerRunListener(async () => {
      this.rainbirdService?.deactivateAllZones();
      this.rainbirdService?.stopIrrigation();
    })
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
