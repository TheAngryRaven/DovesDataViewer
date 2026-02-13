import { memo } from 'react';
import { GraphViewPanel, type GraphViewPanelProps } from '@/components/graphview/GraphViewPanel';
import type { VideoSyncState, VideoSyncActions } from '@/hooks/useVideoSync';
import type { GpsSample } from '@/types/racing';

export interface GraphViewTabProps extends GraphViewPanelProps {
  videoState: VideoSyncState;
  videoActions: VideoSyncActions;
  onVideoLoadedMetadata: () => void;
  currentSample: GpsSample | null;
}

export const GraphViewTab = memo(function GraphViewTab(props: GraphViewTabProps) {
  return <GraphViewPanel {...props} />;
});
