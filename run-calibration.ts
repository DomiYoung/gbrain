import { BrainEngine } from './src/core/engine';
import { runPhaseCalibrationProfile } from './src/core/cycle/calibration-profile';

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://light@localhost:5432/gbrain_custom_clean';
  const engine = new BrainEngine({ databaseUrl });
  await engine.init();
  
  try {
    const result = await runPhaseCalibrationProfile(
      { sourceId: 'default', databaseUrl },
      { holder: 'brain' }
    );
    console.log('Calibration Profile Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  } finally {
    await engine.close();
  }
}

main().catch(console.error);
