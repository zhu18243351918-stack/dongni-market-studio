import type { ImageAdjustments } from '../types';

export interface FilterPresetDefinition {
  id: string;
  name: string;
  category: 'landscape' | 'food' | 'portrait';
  description: string;
  colors: [string, string];
  adjustments: ImageAdjustments;
}

export const FILTER_CATEGORIES = [
  { id: 'landscape', name: '风景类' },
  { id: 'food', name: '食物类' },
  { id: 'portrait', name: '人像类' },
] as const;

export const FILTER_PRESETS: FilterPresetDefinition[] = [
  { id: 'landscape-clear', name: '清透山川', category: 'landscape', description: '提亮阴影与天空层次', colors: ['#77b7d8', '#dff4e6'], adjustments: { brightness: 7, contrast: 10, saturation: 14, temperature: -5, hue: 0, blur: 0 } },
  { id: 'landscape-cinema', name: '电影青橙', category: 'landscape', description: '冷调阴影与暖色高光', colors: ['#155e75', '#f59e0b'], adjustments: { brightness: -2, contrast: 20, saturation: 10, temperature: 5, hue: -8, blur: 0 } },
  { id: 'landscape-forest', name: '雨后森林', category: 'landscape', description: '加强绿色和空气感', colors: ['#14532d', '#86efac'], adjustments: { brightness: 1, contrast: 13, saturation: 22, temperature: -16, hue: 5, blur: 0 } },
  { id: 'landscape-sunset', name: '日落金辉', category: 'landscape', description: '增强夕阳与金色氛围', colors: ['#fb923c', '#fde68a'], adjustments: { brightness: 5, contrast: 9, saturation: 18, temperature: 30, hue: 0, blur: 0 } },
  { id: 'food-warm', name: '美食暖光', category: 'food', description: '适合烘焙、火锅和熟食', colors: ['#7c2d12', '#fdba74'], adjustments: { brightness: 8, contrast: 11, saturation: 21, temperature: 25, hue: 0, blur: 0 } },
  { id: 'food-fresh', name: '鲜味增强', category: 'food', description: '提高食材色泽与细节', colors: ['#dc2626', '#facc15'], adjustments: { brightness: 4, contrast: 17, saturation: 30, temperature: 8, hue: 0, blur: 0 } },
  { id: 'food-coffee', name: '咖啡质感', category: 'food', description: '低饱和深色餐饮氛围', colors: ['#3f2d24', '#c4a484'], adjustments: { brightness: -6, contrast: 19, saturation: -10, temperature: 20, hue: 0, blur: 0 } },
  { id: 'food-dessert', name: '清爽甜品', category: 'food', description: '明亮柔和的甜品色调', colors: ['#f9a8d4', '#dbeafe'], adjustments: { brightness: 13, contrast: -3, saturation: 13, temperature: -7, hue: 0, blur: 0 } },
  { id: 'portrait-cream', name: '奶油肌', category: 'portrait', description: '柔和明亮的肤色表现', colors: ['#fed7aa', '#fff7ed'], adjustments: { brightness: 11, contrast: -9, saturation: -5, temperature: 11, hue: 0, blur: 0 } },
  { id: 'portrait-clean', name: '清透人像', category: 'portrait', description: '自然肤色与轻冷背景', colors: ['#bae6fd', '#fce7f3'], adjustments: { brightness: 8, contrast: 5, saturation: -5, temperature: -4, hue: 0, blur: 0 } },
  { id: 'portrait-film', name: '复古胶片', category: 'portrait', description: '低饱和暖色胶片效果', colors: ['#78350f', '#fde68a'], adjustments: { brightness: -2, contrast: 11, saturation: -19, temperature: 18, hue: -4, blur: 0 } },
  { id: 'portrait-mono', name: '黑白肖像', category: 'portrait', description: '强调人物轮廓与光影', colors: ['#111827', '#d1d5db'], adjustments: { brightness: 2, contrast: 20, saturation: -100, temperature: 0, hue: 0, blur: 0 } },
];

export const TEMPLATE_PRESETS = [
  { id: 'business-card', name: '身份名片', category: '商务', size: '1050 × 600', width: 1050, height: 600, description: '姓名、职位、联系方式与品牌信息' },
  { id: 'video-cover', name: '视频封面', category: '内容', size: '1920 × 1080', width: 1920, height: 1080, description: '适合短视频、B站与课程封面' },
  { id: 'product-main', name: '商品主图', category: '电商', size: '1080 × 1080', width: 1080, height: 1080, description: '商品展示、价格与促销卖点' },
  { id: 'poster', name: '海报模板', category: '营销', size: '1080 × 1440', width: 1080, height: 1440, description: '活动标题、日期和行动按钮' },
  { id: 'meme', name: '表情包制作', category: '趣味', size: '1080 × 1080', width: 1080, height: 1080, description: '图片占位区与上下大字' },
] as const;
