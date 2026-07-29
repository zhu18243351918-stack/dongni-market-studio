import type { FaceDetector as MediaPipeFaceDetector } from '@mediapipe/tasks-vision';
import type { FaceRect } from '../types';

export class FaceDetectionService {
  private detectorPromise: Promise<MediaPipeFaceDetector> | null = null;

  private getDetector() {
    if (!this.detectorPromise) {
      this.detectorPromise = import('@mediapipe/tasks-vision').then(async ({ FaceDetector, FilesetResolver }) => {
        const publicBase = import.meta.env.BASE_URL;
        const vision = await FilesetResolver.forVisionTasks(`${publicBase}mediapipe/wasm`);
        return FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: `${publicBase}models/blaze_face_short_range.tflite`, delegate: 'CPU' },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.45,
          minSuppressionThreshold: 0.3,
        });
      });
    }
    return this.detectorPromise;
  }

  async detect(image: ImageData): Promise<FaceRect[]> {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建人脸识别画布');
    context.putImageData(image, 0, 0);
    const detector = await this.getDetector();
    const result = detector.detect(canvas);
    return result.detections
      .map((detection) => detection.boundingBox)
      .filter((box): box is NonNullable<typeof box> => Boolean(box))
      .map((box) => ({ x: box.originX, y: box.originY, width: box.width, height: box.height }))
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 12);
  }

  destroy() {
    void this.detectorPromise?.then((detector) => detector.close());
    this.detectorPromise = null;
  }
}
