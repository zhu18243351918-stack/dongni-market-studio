export type ToolId =
  | 'select'
  | 'hand'
  | 'crop'
  | 'edge-cutout'
  | 'quick-select'
  | 'magic-wand'
  | 'lasso'
  | 'polygon-lasso'
  | 'text'
  | 'shapes'
  | 'brush'
  | 'erase-brush'
  | 'restore-brush'
  | 'patch'
  | 'face-retouch'
  | 'liquify'
  | 'templates'
  | 'filters'
  | 'styles'
  | 'region'
  | 'workflow';

export type SelectionCombineMode = 'replace' | 'add' | 'subtract';
export type SelectionPreviewMode = 'overlay' | 'transparent' | 'black' | 'white';
export type StrokePosition = 'inside' | 'center' | 'outside';
export type TextCaseMode = 'normal' | 'uppercase' | 'small-caps';
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line' | 'freeform';

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  blur: number;
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hue: 0,
  blur: 0,
};

export interface LayerItem {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  artboardId: string;
  thumbnail?: string;
}

export interface LayerStyleSettings {
  clippingMask: boolean;
  dropShadow: {
    enabled: boolean;
    color: string;
    opacity: number;
    angle: number;
    distance: number;
    blur: number;
  };
  colorOverlay: {
    enabled: boolean;
    color: string;
    opacity: number;
  };
  bevel: {
    enabled: boolean;
    size: number;
    depth: number;
    softness: number;
  };
}

export const DEFAULT_LAYER_STYLE: LayerStyleSettings = {
  clippingMask: false,
  dropShadow: { enabled: false, color: '#000000', opacity: 0.36, angle: 45, distance: 12, blur: 18 },
  colorOverlay: { enabled: false, color: '#f97316', opacity: 0.65 },
  bevel: { enabled: false, size: 4, depth: 45, softness: 3 },
};

export interface ArtboardItem {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: string;
}

export interface RegionDefinition {
  id: string;
  name: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  text: string;
  fontSize: number;
  color: string;
}

export type WorkflowStep =
  | { id: string; type: 'filter'; presetId: string }
  | { id: string; type: 'region-fill'; regionId: string; text: string }
  | { id: string; type: 'export'; format: 'png' | 'jpeg' | 'webp'; scale: 1 | 2 | 3 };

export interface WorkflowDefinition {
  id: string;
  name: string;
  artboardIds: string[];
  steps: WorkflowStep[];
}

export interface SelectionRefineSettings {
  smooth: number;
  feather: number;
  expand: number;
  contrast: number;
  shiftEdge: number;
}

export const DEFAULT_REFINE_SETTINGS: SelectionRefineSettings = {
  smooth: 2,
  feather: 1,
  expand: 0,
  contrast: 0,
  shiftEdge: 0,
};

export interface ProjectDocumentV1 {
  version: 1;
  name: string;
  canvas: {
    width: number;
    height: number;
    background: string;
    resolution?: number;
    colorMode?: DocumentColorMode;
    bitDepth?: DocumentBitDepth;
    colorProfile?: string;
    pixelAspectRatio?: number;
    format?: DocumentNativeFormat;
  };
  artboards?: ArtboardItem[];
  activeArtboardId?: string;
  regions?: RegionDefinition[];
  workflows?: WorkflowDefinition[];
  fabricJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AssetKind = 'original' | 'preview' | 'thumbnail' | 'mask' | 'derived';

export interface AssetDescriptor {
  id: string;
  storageKey: string;
  userId: string;
  projectId: string;
  hash: string;
  name: string;
  mimeType: string;
  kind: AssetKind;
  byteLength: number;
  chunkSize: number;
  chunkCount: number;
  width?: number;
  height?: number;
  sourceAssetId?: string;
  createdAt: string;
}

export interface ArtboardDocumentRef extends ArtboardItem {
  documentKey: string;
  thumbnailAssetId?: string;
  updatedAt: string;
}

export interface HistoryOperationRecord {
  id: string;
  label: string;
  timestamp: number;
  patches: Array<{ path: Array<string | number>; before?: unknown; after?: unknown }>;
}

export interface EditorCommand<T> {
  id: string;
  label: string;
  timestamp: number;
  apply: (state: T) => T;
  revert: (state: T) => T;
  dispose: () => void;
}

export interface ProjectDocumentV2 {
  version: 2;
  id: string;
  userId: string;
  name: string;
  canvas: {
    width: number;
    height: number;
    background: string;
    resolution: number;
    colorMode: DocumentColorMode;
    bitDepth: DocumentBitDepth;
    colorProfile: string;
    pixelAspectRatio: number;
    format?: DocumentNativeFormat;
  };
  artboards: ArtboardDocumentRef[];
  activeArtboardId: string;
  assets: AssetDescriptor[];
  regions: RegionDefinition[];
  workflows: WorkflowDefinition[];
  history?: HistoryOperationRecord[];
  legacyFabricJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ProjectDocument = ProjectDocumentV1 | ProjectDocumentV2;

export interface WorkspaceDocumentTab {
  id: string;
  name: string;
  project?: ProjectDocument;
  updatedAt: string;
}

export interface DocumentWorkspaceState {
  version: 1;
  activeDocumentId: string;
  documents: WorkspaceDocumentTab[];
}

export interface CustomTemplateRecord {
  id: string;
  userId: string;
  name: string;
  width: number;
  height: number;
  background: string;
  previewDataUrl: string;
  objects: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
}

export interface SmartObjectSource {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  format?: DocumentNativeFormat;
  objects: Record<string, unknown>[];
  createdAt: string;
}

export interface ImportPreflightResult {
  kind: 'image' | 'psd' | 'tiff';
  fileName: string;
  fileBytes: number;
  width: number;
  height: number;
  megapixels: number;
  layerCount?: number;
  deviceClass: 'mobile' | 'desktop';
  pixelLimit: number;
  estimatedDecodedBytes: number;
  estimatedPeakBytes: number;
  previewWidth: number;
  previewHeight: number;
  previewScale: number;
  allowed: boolean;
  reason?: string;
}

export interface SelectionMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BrushSeed {
  x: number;
  y: number;
  radius: number;
  foreground: boolean;
}

export interface FaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DocumentColorMode = 'rgb' | 'cmyk' | 'grayscale';
export type DocumentBitDepth = 8 | 16;
export type DocumentNativeFormat = 'psd' | 'psb' | 'tiff' | 'tuyan';

export interface DocumentSettings {
  resolution: number;
  colorMode: DocumentColorMode;
  bitDepth: DocumentBitDepth;
  colorProfile: string;
  pixelAspectRatio: number;
  format: DocumentNativeFormat;
}

export interface EditorObjectMetadata {
  id: string;
  name: string;
  locked?: boolean;
  maskEnabled?: boolean;
  originalSrc?: string;
  maskSrc?: string;
  adjustments?: ImageAdjustments;
  paintLayer?: boolean;
  beautyBaseSrc?: string;
  artboardId?: string;
  isArtboard?: boolean;
  regionId?: string;
  assetId?: string;
  previewAssetId?: string;
  renderAssetId?: string;
  bakedRasterAssetId?: string;
  maskAssetId?: string;
  originalWidth?: number;
  originalHeight?: number;
  lazyVisible?: boolean;
  renderObjectUrl?: string;
  assetSuspended?: boolean;
  layerStyle?: LayerStyleSettings;
  layerStyleBaseFill?: string;
  layerStyleBaseStroke?: string;
  layerStyleBaseStrokeWidth?: number;
  clippingMaskSourceId?: string;
  smartObjectSource?: SmartObjectSource;
  backgroundLayer?: boolean;
  strokePosition?: StrokePosition;
  visualStyle?: 'pixel' | 'comic';
  shapeKind?: ShapeKind;
  cornerRadii?: CornerRadii;
  cornersLinked?: boolean;
  textKerning?: number;
  textTracking?: number;
  textCompression?: number;
  textHorizontalScale?: number;
  textVerticalScale?: number;
  textBaselineShift?: number;
  textCase?: TextCaseMode;
  textOriginalText?: string;
  textBaseFontWeight?: string;
  textFauxBold?: boolean;
  textFauxItalic?: boolean;
  textSuperscript?: boolean;
  textSubscript?: boolean;
}

export interface StoredFontAsset {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export interface InspectorState {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokePosition: StrokePosition;
  shapeKind: ShapeKind | '';
  cornerRadius: number;
  cornerTopLeft: number;
  cornerTopRight: number;
  cornerBottomRight: number;
  cornerBottomLeft: number;
  cornersLinked: boolean;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: string;
  lineHeight: number;
  textKerning: number;
  textTracking: number;
  textCompression: number;
  textHorizontalScale: number;
  textVerticalScale: number;
  textBaselineShift: number;
  textCase: TextCaseMode;
  textFauxBold: boolean;
  textFauxItalic: boolean;
  textSuperscript: boolean;
  textSubscript: boolean;
  underline: boolean;
  linethrough: boolean;
}

export const DEFAULT_INSPECTOR: InspectorState = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  angle: 0,
  opacity: 1,
  fill: '#ffffff',
  fillOpacity: 1,
  stroke: '#000000',
  strokeOpacity: 1,
  strokeWidth: 0,
  strokePosition: 'center',
  shapeKind: '',
  cornerRadius: 0,
  cornerTopLeft: 0,
  cornerTopRight: 0,
  cornerBottomRight: 0,
  cornerBottomLeft: 0,
  cornersLinked: true,
  fontSize: 48,
  fontFamily: 'Source Han Sans SC',
  fontWeight: '400',
  textAlign: 'left',
  lineHeight: 1.2,
  textKerning: 0,
  textTracking: 0,
  textCompression: 0,
  textHorizontalScale: 100,
  textVerticalScale: 100,
  textBaselineShift: 0,
  textCase: 'normal',
  textFauxBold: false,
  textFauxItalic: false,
  textSuperscript: false,
  textSubscript: false,
  underline: false,
  linethrough: false,
};
