using System.Text;

namespace BeatSync.API.Data;

public static class AudioGenerator
{
    public static void EnsureSampleTracksExist(string wwwrootPath)
    {
        var audioDir = Path.Combine(wwwrootPath, "audio");
        if (!Directory.Exists(audioDir))
        {
            Directory.CreateDirectory(audioDir);
        }

        var track1 = Path.Combine(audioDir, "neon_horizon.wav");
        var track2 = Path.Combine(audioDir, "midnight_beats.wav");
        var track3 = Path.Combine(audioDir, "solar_echoes.wav");

        if (!File.Exists(track1))
        {
            File.WriteAllBytes(track1, GenerateSynthwaveTrack(45)); // 45s track
        }

        if (!File.Exists(track2))
        {
            File.WriteAllBytes(track2, GenerateLofiTrack(50)); // 50s track
        }

        if (!File.Exists(track3))
        {
            File.WriteAllBytes(track3, GenerateAmbientTrack(40)); // 40s track
        }
    }

    private static byte[] GenerateSynthwaveTrack(int durationSeconds)
    {
        int sampleRate = 44100;
        int totalSamples = sampleRate * durationSeconds;
        short[] samples = new short[totalSamples];

        double bpm = 120.0;
        double beatInterval = 60.0 / bpm; // 0.5s per beat
        double[] chordFreqs = [220.0, 261.63, 329.63, 392.0]; // Am7: A, C, E, G

        for (int i = 0; i < totalSamples; i++)
        {
            double t = (double)i / sampleRate;
            double beatTime = t % beatInterval;
            int beatIndex = (int)(t / beatInterval);

            // Kick on beats 0, 2 (of 4-beat bar)
            double kick = 0;
            if (beatIndex % 2 == 0)
            {
                double kickEnv = Math.Max(0.0, 1.0 - (beatTime / 0.25));
                double kickPitch = 55.0 + 80.0 * kickEnv;
                kick = Math.Sin(2.0 * Math.PI * kickPitch * beatTime) * kickEnv * 0.45;
            }

            // Snare / clap on beats 1, 3
            double snare = 0;
            if (beatIndex % 2 == 1)
            {
                double snareEnv = Math.Max(0.0, 1.0 - (beatTime / 0.2));
                double noise = ((double)(i * 9301 + 49297) % 233280) / 233280.0 * 2.0 - 1.0;
                snare = (noise * 0.7 + Math.Sin(2.0 * Math.PI * 180.0 * beatTime) * 0.3) * snareEnv * 0.35;
            }

            // Hi-hat on every 8th note
            double eighthTime = t % (beatInterval / 2.0);
            double hatEnv = Math.Max(0.0, 1.0 - (eighthTime / 0.05));
            double hatNoise = ((double)(i * 49297 + 9301) % 233280) / 233280.0 * 2.0 - 1.0;
            double hat = hatNoise * hatEnv * 0.15;

            // Synth chords (arpeggio)
            int noteIdx = (int)(t / (beatInterval / 4.0)) % chordFreqs.Length;
            double noteFreq = chordFreqs[noteIdx] * (1.0 + (beatIndex % 4 == 3 ? 0.5 : 0.0));
            double synth = Math.Sin(2.0 * Math.PI * noteFreq * t) * 0.2;
            synth += Math.Sin(4.0 * Math.PI * noteFreq * t) * 0.08; // 2nd harmonic

            // Bassline
            double bassFreq = chordFreqs[0] / 2.0; // 110 Hz
            double bass = (Math.Sin(2.0 * Math.PI * bassFreq * t) > 0 ? 0.15 : -0.15); // square bass

            double mixed = kick + snare + hat + synth + bass;
            mixed = Math.Clamp(mixed, -0.95, 0.95);
            samples[i] = (short)(mixed * short.MaxValue);
        }

        return CreateWavFile(samples, sampleRate);
    }

    private static byte[] GenerateLofiTrack(int durationSeconds)
    {
        int sampleRate = 44100;
        int totalSamples = sampleRate * durationSeconds;
        short[] samples = new short[totalSamples];

        double bpm = 85.0;
        double beatInterval = 60.0 / bpm;
        double[] chords = [174.61, 220.0, 261.63, 311.13]; // Fmaj7 / F A C Eb

        for (int i = 0; i < totalSamples; i++)
        {
            double t = (double)i / sampleRate;
            double beatTime = t % beatInterval;
            int beatIndex = (int)(t / beatInterval);

            // Mellow soft kick
            double kick = 0;
            if (beatIndex % 4 == 0 || beatIndex % 4 == 2)
            {
                double kickEnv = Math.Max(0.0, 1.0 - (beatTime / 0.3));
                kick = Math.Sin(2.0 * Math.PI * 60.0 * beatTime) * kickEnv * 0.4;
            }

            // Soft snare rim
            double rim = 0;
            if (beatIndex % 4 == 1 || beatIndex % 4 == 3)
            {
                double rimEnv = Math.Max(0.0, 1.0 - (beatTime / 0.12));
                double noise = ((double)(i * 65537 + 12345) % 131072) / 131072.0 * 2.0 - 1.0;
                rim = (noise * 0.5 + Math.Sin(2.0 * Math.PI * 320.0 * beatTime) * 0.5) * rimEnv * 0.25;
            }

            // Warm electric piano chord
            double chordSound = 0;
            foreach (var freq in chords)
            {
                chordSound += Math.Sin(2.0 * Math.PI * freq * t) * 0.08;
                chordSound += Math.Sin(2.0 * Math.PI * (freq * 2.0) * t) * 0.03;
            }

            // Vinyl crackle subtle texture
            double vinyl = (((double)(i * 32771) % 65536) / 65536.0 > 0.992) ? 0.05 : 0.0;

            double mixed = kick + rim + chordSound + vinyl;
            mixed = Math.Clamp(mixed, -0.95, 0.95);
            samples[i] = (short)(mixed * short.MaxValue);
        }

        return CreateWavFile(samples, sampleRate);
    }

    private static byte[] GenerateAmbientTrack(int durationSeconds)
    {
        int sampleRate = 44100;
        int totalSamples = sampleRate * durationSeconds;
        short[] samples = new short[totalSamples];

        double[] freqs = [130.81, 196.0, 261.63, 392.0]; // C, G, C, G harmonics

        for (int i = 0; i < totalSamples; i++)
        {
            double t = (double)i / sampleRate;
            double lfo = 0.5 + 0.5 * Math.Sin(2.0 * Math.PI * 0.2 * t); // slow pulse 0.2 Hz

            double ambient = 0;
            for (int f = 0; f < freqs.Length; f++)
            {
                double phaseOffset = f * 0.5;
                ambient += Math.Sin(2.0 * Math.PI * freqs[f] * t + phaseOffset) * (0.12 / (f + 1));
            }

            ambient *= lfo;
            ambient = Math.Clamp(ambient, -0.95, 0.95);
            samples[i] = (short)(ambient * short.MaxValue);
        }

        return CreateWavFile(samples, sampleRate);
    }

    private static byte[] CreateWavFile(short[] samples, int sampleRate)
    {
        int channels = 1;
        int bitsPerSample = 16;
        int byteRate = sampleRate * channels * (bitsPerSample / 8);
        int blockAlign = channels * (bitsPerSample / 8);
        int subChunk2Size = samples.Length * (bitsPerSample / 8);
        int chunkSize = 36 + subChunk2Size;

        using var ms = new MemoryStream();
        using var writer = new BinaryWriter(ms);

        // RIFF header
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(chunkSize);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));

        // "fmt " subchunk
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16); // Subchunk1Size (16 for PCM)
        writer.Write((short)1); // AudioFormat (1 = PCM)
        writer.Write((short)channels);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write((short)blockAlign);
        writer.Write((short)bitsPerSample);

        // "data" subchunk
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(subChunk2Size);

        foreach (var sample in samples)
        {
            writer.Write(sample);
        }

        return ms.ToArray();
    }
}
