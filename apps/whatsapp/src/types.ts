export type Json = Record<string, unknown>;

export type ServiceStatus = {
  status: 'Iniciando' | 'Em execução' | 'Pausado' | 'Erro';
  port: number;
  dashboardUrl: string;
  queueCount: number;
  currentJob: { id: string; status: string } | null;
  paused: boolean;
};

export type JobRecord = {
  id: string;
  session_id: string | null;
  instance_id: string;
  template_id: string;
  phone_e164: string;
  input_path: string;
  output_path: string;
  title_original: string;
  title_final: string;
  flags_raw: string;
  config_json: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
};

export type RenderJobInput = {
  job: JobRecord;
  template: { id: string; name: string; slug: string; config: Json; logoPath: string | null };
  inputPath: string;
  outputPath: string;
  title: string;
  alignment: { vertical?: { direction: 'top' | 'bottom'; percent: number }; horizontal?: { direction: 'left' | 'right'; percent: number } };
  grayscale: boolean;
  forceKeepLong?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  preset?: string;
  crf?: number;
  maxInputBytes?: number;
  maxDurationSeconds?: number;
  onProgress?: (progress: number, detail?: string) => void;
  onEvent?: (stage: string, level: string, message: string, meta?: Record<string, unknown>) => void;
};

export type RenderProcessor = (input: RenderJobInput) => Promise<{ outputPath: string; width: number; height: number; durationSeconds: number; inputBytes: number; outputBytes: number; inputWidth: number; inputHeight: number; fps: number }>;
