declare module "virtual:external-plugins" {
  import type { DataViewerPlugin } from "@/plugins/types";
  /** Coach (and other external) plugins installed as npm packages at build time. */
  const plugins: DataViewerPlugin[];
  export default plugins;
}
