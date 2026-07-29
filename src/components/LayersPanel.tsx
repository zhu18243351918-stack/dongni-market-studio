import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Circle, Combine, Download, Eye, EyeOff, Focus, GripVertical, Group, Image, Layers3, Lock, LockOpen, Minus, MousePointer2, Palette, PanelsTopLeft, Plus, Scissors, Sparkles, Square, Trash2, Triangle, Type, Ungroup } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EditorEngine } from '../editor/EditorEngine';
import { DEFAULT_LAYER_STYLE, type ArtboardItem, type LayerItem, type LayerStyleSettings } from '../types';
import { useEditorStore } from '../store/editorStore';

function LayerIcon({ type }: { type: string }) {
  if (type === 'smart-object') return <Box size={15} />;
  if (type === 'image') return <Image size={15} />;
  if (['i-text', 'textbox', 'text'].includes(type)) return <Type size={15} />;
  if (type === 'circle') return <Circle size={15} />;
  if (type === 'line') return <Minus size={15} />;
  if (type === 'triangle') return <Triangle size={15} />;
  if (type === 'rect') return <Square size={15} />;
  return <MousePointer2 size={15} />;
}

function SortableLayer({ layer, selected, engine }: { layer: LayerItem; selected: boolean; engine: EditorEngine }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const finishRename = () => {
    setEditing(false);
    engine.renameLayer(layer.id, name);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`layer-row ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      data-layer-id={layer.id}
      data-layer-type={layer.type}
      onClick={(event) => engine.selectLayer(layer.id, event.shiftKey)}
    >
      <button type="button" className="layer-grip" aria-label="拖动排序" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      <span className="layer-type-icon"><LayerIcon type={layer.type} /></span>
      {editing ? (
        <input
          className="layer-name-input"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="layer-name" onDoubleClick={() => layer.type === 'smart-object' ? engine.openSmartObject(layer.id) : setEditing(true)}>{layer.name}{layer.type === 'smart-object' && <small className="smart-object-hint">双击编辑</small>}</button>
      )}
      <button
        type="button"
        className="layer-action"
        aria-label={layer.visible ? '隐藏图层' : '显示图层'}
        onClick={(event) => { event.stopPropagation(); engine.setLayerVisibility(layer.id); }}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        type="button"
        className="layer-action"
        aria-label={layer.locked ? '解锁图层' : '锁定图层'}
        onClick={(event) => { event.stopPropagation(); engine.setLayerLocked(layer.id); }}
      >
        {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
      <button
        type="button"
        className="layer-action layer-delete"
        aria-label={`删除图层 ${layer.name}`}
        onClick={(event) => { event.stopPropagation(); engine.deleteLayer(layer.id); }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function LayerStylePanel({ engine, selectedIds }: { engine: EditorEngine; selectedIds: string[] }) {
  const [style, setStyle] = useState<LayerStyleSettings>(DEFAULT_LAYER_STYLE);
  const hasSingleLayer = selectedIds.length === 1;

  useEffect(() => {
    setStyle(hasSingleLayer ? engine.getActiveLayerStyle() : DEFAULT_LAYER_STYLE);
  }, [engine, hasSingleLayer, selectedIds]);

  const update = (next: LayerStyleSettings, commit = false) => {
    setStyle(next);
    engine.updateActiveLayerStyle(next, commit);
  };

  const toggleClip = async () => {
    await engine.toggleClippingMask(!style.clippingMask);
    setStyle(engine.getActiveLayerStyle());
  };

  return (
    <section className={`layer-style-panel ${hasSingleLayer ? '' : 'is-disabled'}`}>
      {!hasSingleLayer && <div className="layer-style-empty">选择一个图层后设置剪切蒙版和效果</div>}
      {hasSingleLayer && <>
        <button type="button" className={`layer-style-toggle ${style.clippingMask ? 'is-active' : ''}`} onClick={() => void toggleClip()}><span><Scissors size={14} /><b>剪切蒙版</b></span><em>{style.clippingMask ? '已开启' : '剪切到下方图层'}</em></button>

        <div className="layer-style-effect">
          <label className="layer-style-toggle"><span><Box size={14} /><b>投影</b></span><input type="checkbox" checked={style.dropShadow.enabled} onChange={(event) => update({ ...style, dropShadow: { ...style.dropShadow, enabled: event.target.checked } }, true)} /></label>
          {style.dropShadow.enabled && <div className="layer-style-controls">
            <label className="layer-style-color"><span>颜色</span><input type="color" value={style.dropShadow.color} onChange={(event) => update({ ...style, dropShadow: { ...style.dropShadow, color: event.target.value } })} onBlur={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>不透明度 <output>{Math.round(style.dropShadow.opacity * 100)}%</output></span><input type="range" min={0} max={100} value={style.dropShadow.opacity * 100} onChange={(event) => update({ ...style, dropShadow: { ...style.dropShadow, opacity: Number(event.target.value) / 100 } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>距离 <output>{style.dropShadow.distance}px</output></span><input type="range" min={0} max={80} value={style.dropShadow.distance} onChange={(event) => update({ ...style, dropShadow: { ...style.dropShadow, distance: Number(event.target.value) } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>模糊 <output>{style.dropShadow.blur}px</output></span><input type="range" min={0} max={80} value={style.dropShadow.blur} onChange={(event) => update({ ...style, dropShadow: { ...style.dropShadow, blur: Number(event.target.value) } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
          </div>}
        </div>

        <div className="layer-style-effect">
          <label className="layer-style-toggle"><span><Palette size={14} /><b>颜色叠加</b></span><input type="checkbox" checked={style.colorOverlay.enabled} onChange={(event) => update({ ...style, colorOverlay: { ...style.colorOverlay, enabled: event.target.checked } }, true)} /></label>
          {style.colorOverlay.enabled && <div className="layer-style-controls compact">
            <label className="layer-style-color"><span>叠加颜色</span><input type="color" value={style.colorOverlay.color} onChange={(event) => update({ ...style, colorOverlay: { ...style.colorOverlay, color: event.target.value } })} onBlur={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>不透明度 <output>{Math.round(style.colorOverlay.opacity * 100)}%</output></span><input type="range" min={0} max={100} value={style.colorOverlay.opacity * 100} onChange={(event) => update({ ...style, colorOverlay: { ...style.colorOverlay, opacity: Number(event.target.value) / 100 } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
          </div>}
        </div>

        <div className="layer-style-effect">
          <label className="layer-style-toggle"><span><Sparkles size={14} /><b>斜面和浮雕</b></span><input type="checkbox" checked={style.bevel.enabled} onChange={(event) => update({ ...style, bevel: { ...style.bevel, enabled: event.target.checked } }, true)} /></label>
          {style.bevel.enabled && <div className="layer-style-controls">
            <label><span>大小 <output>{style.bevel.size}px</output></span><input type="range" min={1} max={30} value={style.bevel.size} onChange={(event) => update({ ...style, bevel: { ...style.bevel, size: Number(event.target.value) } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>深度 <output>{style.bevel.depth}%</output></span><input type="range" min={1} max={100} value={style.bevel.depth} onChange={(event) => update({ ...style, bevel: { ...style.bevel, depth: Number(event.target.value) } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
            <label><span>柔化 <output>{style.bevel.softness}px</output></span><input type="range" min={0} max={20} value={style.bevel.softness} onChange={(event) => update({ ...style, bevel: { ...style.bevel, softness: Number(event.target.value) } })} onPointerUp={() => engine.updateActiveLayerStyle(engine.getActiveLayerStyle(), true)} /></label>
          </div>}
        </div>
      </>}
    </section>
  );
}

export function LayersPanel({ engine }: { engine: EditorEngine }) {
  const layers = useEditorStore((state) => state.layers);
  const artboards = useEditorStore((state) => state.artboards);
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const inspector = useEditorStore((state) => state.inspector);
  const setInspector = useEditorStore((state) => state.setInspector);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = useMemo(() => layers.map((layer) => layer.id), [layers]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const reordered = arrayMove(ids, oldIndex, newIndex);
    const targetIndex = reordered.indexOf(String(active.id));
    const targetId = reordered[Math.max(0, Math.min(reordered.length - 1, targetIndex + (newIndex > oldIndex ? -1 : 1)))];
    engine.reorderLayer(String(active.id), targetId || String(over.id));
  };

  return (
    <div className="layers-panel">
      <div className="panel-section-heading artboard-panel-heading">
        <div><strong><PanelsTopLeft size={14} />画板与图层</strong><span>{artboards.length}</span></div>
        <small>画板是最高分类 · 双击名称重命名</small>
        <div className="artboard-heading-actions">
          <button type="button" onClick={() => engine.createArtboard()}><Plus size={13} />新建画板</button>
          <button type="button" disabled={!artboards.length} onClick={() => void engine.exportAllArtboards('png')}><Download size={13} />导出全部</button>
          <button type="button" className="artboard-smart-object-action" disabled={!layers.length} onClick={() => void engine.convertToSmartObject('artboard')}><Box size={13} />画板转智能对象</button>
        </div>
      </div>
      {selectedIds.length > 0 && (
        <label className="layer-opacity-control">
          <span><b>图层不透明度</b><output>{Math.round(inspector.opacity * 100)}%</output></span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={inspector.opacity * 100}
            onChange={(event) => {
              const opacity = Number(event.target.value) / 100;
              setInspector({ opacity });
              engine.updateActiveProperties({ opacity });
            }}
            onPointerUp={() => engine.commitPropertyChange()}
            onKeyUp={() => engine.commitPropertyChange()}
          />
        </label>
      )}
      {artboards.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="artboard-tree">
            {artboards.map((artboard) => (
              <ArtboardGroup
                key={artboard.id}
                artboard={artboard}
                layers={layers.filter((layer) => layer.artboardId === artboard.id)}
                selectedIds={selectedIds}
                active={activeArtboardId === artboard.id}
                canDelete={artboards.length > 1}
                engine={engine}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="panel-empty">
          <Layers3 size={24} />
          <strong>还没有画板</strong>
          <span>新建画布后即可开始编辑</span>
        </div>
      )}
      {layers.length > 0 && (
        <div className="layer-footer-actions">
          <button type="button" onClick={() => engine.groupActive()}><Group size={14} />编组</button>
          <button type="button" onClick={() => engine.ungroupActive()}><Ungroup size={14} />取消编组</button>
          <button type="button" onClick={() => void engine.mergeActiveDown()}><Combine size={14} />向下合并</button>
          <button type="button" onClick={() => void engine.mergeVisibleLayers()}><Combine size={14} />合并可见</button>
          <button type="button" disabled={selectedIds.length === 0} onClick={() => void engine.convertToSmartObject('selection')}><Box size={14} />转智能对象</button>
        </div>
      )}
      <LayerStylePanel engine={engine} selectedIds={selectedIds} />
    </div>
  );
}

function ArtboardGroup({
  artboard,
  layers,
  selectedIds,
  active,
  canDelete,
  engine,
}: {
  artboard: ArtboardItem;
  layers: LayerItem[];
  selectedIds: string[];
  active: boolean;
  canDelete: boolean;
  engine: EditorEngine;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(artboard.name);
  const layerIds = useMemo(() => layers.map((layer) => layer.id), [layers]);
  const finishRename = () => {
    setEditing(false);
    engine.renameArtboard(artboard.id, name);
  };
  return (
    <section className={`artboard-group ${active ? 'is-active' : ''}`}>
      <div className="artboard-row" onClick={() => engine.selectArtboard(artboard.id)}>
        <span className="artboard-type-icon"><PanelsTopLeft size={15} /></span>
        <div className="artboard-name-wrap">
          {editing ? (
            <input
              className="layer-name-input"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') finishRename();
                if (event.key === 'Escape') setEditing(false);
              }}
            />
          ) : <button type="button" className="artboard-name" onDoubleClick={() => setEditing(true)}>{artboard.name}</button>}
          <small>{artboard.width} × {artboard.height} · {layers.length} 层</small>
        </div>
        <button type="button" className="layer-action" title="定位画板" aria-label={`定位${artboard.name}`} onClick={(event) => { event.stopPropagation(); engine.selectArtboard(artboard.id, true); }}><Focus size={14} /></button>
        <button type="button" className="layer-action" title="导出画板" aria-label={`导出${artboard.name}`} onClick={(event) => { event.stopPropagation(); void engine.exportArtboard(artboard.id); }}><Download size={14} /></button>
        <button type="button" className="layer-action layer-delete" disabled={!canDelete} title="删除画板" aria-label={`删除${artboard.name}`} onClick={(event) => { event.stopPropagation(); engine.deleteArtboard(artboard.id); }}><Trash2 size={14} /></button>
      </div>
      <SortableContext items={layerIds} strategy={verticalListSortingStrategy}>
        <div className="layer-list artboard-layer-list">
          {layers.length ? layers.map((layer) => (
            <SortableLayer key={layer.id} layer={layer} selected={selectedIds.includes(layer.id)} engine={engine} />
          )) : <div className="artboard-empty-layer"><Image size={14} />这个画板还没有图层</div>}
        </div>
      </SortableContext>
    </section>
  );
}
