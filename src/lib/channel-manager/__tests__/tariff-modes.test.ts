import { describe, expect, it } from 'vitest';
import {
  CHANNEL_MANAGER_MOCK_CHANNELS,
  CHANNEL_MANAGER_MODES,
  channelManagerModeHasFeature,
  channelManagerModeShowsBlock,
  normalizeChannelManagerMode,
} from '../tariff-modes';

describe('channel manager tariff modes', () => {
  it('supports three owner-facing modes', () => {
    expect(Object.keys(CHANNEL_MANAGER_MODES)).toEqual(['manual', 'assisted', 'autopilot']);
    expect(CHANNEL_MANAGER_MODES.manual.label).toBe('Ручной режим');
    expect(CHANNEL_MANAGER_MODES.assisted.label).toBe('Полуавтомат');
    expect(CHANNEL_MANAGER_MODES.autopilot.label).toBe('Автопилот');
  });

  it('keeps visibility different by mode', () => {
    expect(channelManagerModeShowsBlock('manual', 'manualActions')).toBe(true);
    expect(channelManagerModeShowsBlock('assisted', 'preparedChanges')).toBe(true);
    expect(channelManagerModeShowsBlock('autopilot', 'autopilotLimits')).toBe(true);
    expect(channelManagerModeShowsBlock('autopilot', 'manualActions')).toBe(false);
  });

  it('keeps active API out of mock channels', () => {
    expect(CHANNEL_MANAGER_MOCK_CHANNELS).toHaveLength(7);
    const connectionTypes = CHANNEL_MANAGER_MOCK_CHANNELS.map((channel) => channel.connectionType as string);
    expect(connectionTypes).not.toContain('Активный API');
  });

  it('normalizes unknown mode to manual', () => {
    expect(normalizeChannelManagerMode('assisted')).toBe('assisted');
    expect(normalizeChannelManagerMode('autopilot')).toBe('autopilot');
    expect(normalizeChannelManagerMode('unknown')).toBe('manual');
    expect(channelManagerModeHasFeature('manual', 'objectDataLink')).toBe(true);
  });
});
