import type { FrameFormValues } from "../FrameForm";
import { FrameDraftImporter } from "../FrameDraftImporter";
import styles from "../../../admin.module.css";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

export default function NewFramePage() {
  const values: FrameFormValues = {
    id: null,
    slug: "",
    catalogId: "",
    commonName: "",
    frameNumber: "",
    revision: "",
    capturedOn: today(),
    palette: "HOO",
    bandwidth: "3nm",
    integrationHours: 0,
    integrationMinutes: 0,
    metaLine: "",
    blurb: "",
    bodyMarkdown: "",
    note: "",
    plateCatalog: "",
    plateClass: "",
    plateConstellation: "",
    plateDistance: "",
    plateCoordinates: "",
    platePalette: "",
    plateSessions: "",
    plateSky: "Bortle 9",
    // Pre-filled from the real rig, since they rarely change between frames.
    opticsLabel: "RedCat 51 WIFD",
    sensorLabel: "QHY Minicam8M (IMX585)",
    arcsecPerPx: "2.393",
    published: false,
  };

  return (
    <>
      <h1 className={styles.pageTitle}>New frame</h1>
      <p className={styles.pageSub}>Save first, then upload the master</p>

      <FrameDraftImporter defaults={values} />
    </>
  );
}
