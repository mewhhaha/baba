export class GpuFrontendCapacityError extends Error {
  readonly bufferName: string;
  readonly required: number;
  readonly available: number;

  constructor(bufferName: string, required: number, available: number) {
    super(
      `GPU frontend ${bufferName} buffer needs ${required} bytes, but the device limit is ${available}.`,
    );
    this.name = "GpuFrontendCapacityError";
    this.bufferName = bufferName;
    this.required = required;
    this.available = available;
  }
}
