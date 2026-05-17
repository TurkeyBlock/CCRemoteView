type ComputerTypeConfig = { rotation: (rot: number) => [number, number, number] }

export const computerTypeConfig: Record<string, ComputerTypeConfig> = {
  minecart:   { rotation: (_rot): [number, number, number] => [0, 0, 0] },
  turtle:     { rotation: (rot): [number, number, number] => [Math.PI / 2, 0, ((rot + 1) * Math.PI) / 2] },
  player:     { rotation: (rot): [number, number, number] => [Math.PI / 2, 0, ((rot + 1) * Math.PI) / 2] },
  stationary: { rotation: (rot): [number, number, number] => [Math.PI / 2, 0, ((rot + 1) * Math.PI) / 2] },
};

export const defaultComputerTypeConfig: ComputerTypeConfig = computerTypeConfig.turtle;
