import { memo } from 'react';
import { GraphViewPanel, GraphViewPanelProps } from '@/components/graphview/GraphViewPanel';

export const GraphViewTab = memo(function GraphViewTab(props: GraphViewPanelProps) {
  return <GraphViewPanel {...props} />;
});
