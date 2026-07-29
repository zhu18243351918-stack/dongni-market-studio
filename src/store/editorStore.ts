import { create } from 'zustand';
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_INSPECTOR,
  DEFAULT_REFINE_SETTINGS,
  type ImageAdjustments,
  type InspectorState,
  type ArtboardItem,
  type RegionDefinition,
  type WorkflowDefinition,
  type LayerItem,
  type SelectionCombineMode,
  type SelectionPreviewMode,
  type SelectionRefineSettings,
  type ToolId,
} from '../types';

interface EditorState {
  activeTool: ToolId;
  selectedId: string | null;
  selectedIds: string[];
  selectedType: string | null;
  layers: LayerItem[];
  artboards: ArtboardItem[];
  activeArtboardId: string;
  regions: RegionDefinition[];
  workflows: WorkflowDefinition[];
  zoom: number;
  viewportX: number;
  viewportY: number;
  canUndo: boolean;
  canRedo: boolean;
  isProcessing: boolean;
  processingLabel: string;
  selectionCombine: SelectionCombineMode;
  selectionTolerance: number;
  selectionContiguous: boolean;
  brushSize: number;
  eraserSize: number;
  brushSubtract: boolean;
  previewMode: SelectionPreviewMode;
  refine: SelectionRefineSettings;
  adjustments: ImageAdjustments;
  inspector: InspectorState;
  rightTab: 'properties' | 'layers';
  mobilePanel: 'tools' | 'properties' | 'layers' | null;
  theme: 'dark' | 'light';
  fontFamilies: string[];
  showGrid: boolean;
  snapEnabled: boolean;
  uniformScaling: boolean;
  showControls: boolean;
  beautySmooth: number;
  faceSlim: number;
  liquifySize: number;
  liquifyStrength: number;
  setTool: (tool: ToolId) => void;
  setSelection: (id: string | null, type?: string | null, ids?: string[]) => void;
  setLayers: (layers: LayerItem[]) => void;
  setArtboards: (artboards: ArtboardItem[], activeArtboardId: string) => void;
  setRegions: (regions: RegionDefinition[]) => void;
  setWorkflows: (workflows: WorkflowDefinition[]) => void;
  setZoom: (zoom: number) => void;
  setViewport: (x: number, y: number) => void;
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void;
  setProcessing: (value: boolean, label?: string) => void;
  setSelectionCombine: (mode: SelectionCombineMode) => void;
  setSelectionTolerance: (value: number) => void;
  setSelectionContiguous: (value: boolean) => void;
  setBrushSize: (value: number) => void;
  setEraserSize: (value: number) => void;
  setBrushSubtract: (value: boolean) => void;
  setPreviewMode: (mode: SelectionPreviewMode) => void;
  setRefine: (settings: Partial<SelectionRefineSettings>) => void;
  setAdjustments: (adjustments: Partial<ImageAdjustments>) => void;
  setInspector: (inspector: Partial<InspectorState>) => void;
  resetAdjustments: () => void;
  setRightTab: (tab: 'properties' | 'layers') => void;
  setMobilePanel: (panel: EditorState['mobilePanel']) => void;
  toggleTheme: () => void;
  setFontFamilies: (fonts: string[]) => void;
  addFontFamily: (font: string) => void;
  setShowGrid: (value: boolean) => void;
  setSnapEnabled: (value: boolean) => void;
  setUniformScaling: (value: boolean) => void;
  setShowControls: (value: boolean) => void;
  setBeautySmooth: (value: number) => void;
  setFaceSlim: (value: number) => void;
  setLiquifySize: (value: number) => void;
  setLiquifyStrength: (value: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTool: 'select',
  selectedId: null,
  selectedIds: [],
  selectedType: null,
  layers: [],
  artboards: [],
  activeArtboardId: '',
  regions: [],
  workflows: [],
  zoom: 1,
  viewportX: 0,
  viewportY: 0,
  canUndo: false,
  canRedo: false,
  isProcessing: false,
  processingLabel: '',
  selectionCombine: 'replace',
  selectionTolerance: 28,
  selectionContiguous: true,
  brushSize: 38,
  eraserSize: 54,
  brushSubtract: false,
  previewMode: 'overlay',
  refine: DEFAULT_REFINE_SETTINGS,
  adjustments: DEFAULT_ADJUSTMENTS,
  inspector: DEFAULT_INSPECTOR,
  rightTab: 'properties',
  mobilePanel: null,
  theme: 'light',
  fontFamilies: [],
  showGrid: true,
  snapEnabled: true,
  uniformScaling: true,
  showControls: true,
  beautySmooth: 35,
  faceSlim: 20,
  liquifySize: 140,
  liquifyStrength: 55,
  setTool: (activeTool) => set({ activeTool }),
  setSelection: (selectedId, selectedType = null, selectedIds = selectedId ? [selectedId] : []) => set({ selectedId, selectedType, selectedIds }),
  setLayers: (layers) => set({ layers }),
  setArtboards: (artboards, activeArtboardId) => set({ artboards, activeArtboardId }),
  setRegions: (regions) => set({ regions }),
  setWorkflows: (workflows) => set({ workflows }),
  setZoom: (zoom) => set({ zoom }),
  setViewport: (viewportX, viewportY) => set({ viewportX, viewportY }),
  setHistoryState: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setProcessing: (isProcessing, processingLabel = '') => set({ isProcessing, processingLabel }),
  setSelectionCombine: (selectionCombine) => set({ selectionCombine }),
  setSelectionTolerance: (selectionTolerance) => set({ selectionTolerance }),
  setSelectionContiguous: (selectionContiguous) => set({ selectionContiguous }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setEraserSize: (eraserSize) => set({ eraserSize }),
  setBrushSubtract: (brushSubtract) => set({ brushSubtract }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  setRefine: (refine) => set((state) => ({ refine: { ...state.refine, ...refine } })),
  setAdjustments: (adjustments) => set((state) => ({ adjustments: { ...state.adjustments, ...adjustments } })),
  setInspector: (inspector) => set((state) => ({ inspector: { ...state.inspector, ...inspector } })),
  resetAdjustments: () => set({ adjustments: DEFAULT_ADJUSTMENTS }),
  setRightTab: (rightTab) => set({ rightTab }),
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setFontFamilies: (fontFamilies) => set({ fontFamilies }),
  addFontFamily: (font) => set((state) => ({ fontFamilies: state.fontFamilies.includes(font) ? state.fontFamilies : [...state.fontFamilies, font] })),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setUniformScaling: (uniformScaling) => set({ uniformScaling }),
  setShowControls: (showControls) => set({ showControls }),
  setBeautySmooth: (beautySmooth) => set({ beautySmooth }),
  setFaceSlim: (faceSlim) => set({ faceSlim }),
  setLiquifySize: (liquifySize) => set({ liquifySize }),
  setLiquifyStrength: (liquifyStrength) => set({ liquifyStrength }),
}));
