import {
  getExecutionFeedChannelId,
  getExecutionPanelChannelId,
  getExecutionPanelGuildId,
} from '../execution-panel-env';
import { mergeGuildFeatures } from '../features';
import type { GuildConfig } from './types';

const panelGuildId = getExecutionPanelGuildId();
const panelChannelId = getExecutionPanelChannelId();
const feedChannelId = getExecutionFeedChannelId();

/**
 * Execution Layer — Open Loop domain (Mode Labs defaults in {@link ../execution-panel-env}).
 * Panel channel = control surface; feed channel = public output.
 */
export const executionLayerGuild: GuildConfig = {
  guildId: panelGuildId,
  guildType: 'execution',
  features: mergeGuildFeatures({
    missionsEnabled: false,
    executionEnabled: true,
    publicSessionMessages: true,
    verdictEnabled: true,
  }),
  channels: {
    executionChannelId: panelChannelId,
    executionFeedChannelId: feedChannelId,
  },
};
