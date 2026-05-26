import { Audio as ExpoAudio } from "expo-av";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import * as ImageManipulator from "expo-image-manipulator";
import NfcManager, { NfcEvents } from "react-native-nfc-manager";
import { apiFetch, getApiUrl, setApiUrl, setToken } from "./src/api";
import {
    clearPessoas,
    findPessoaByCredencial,
    getUnsyncedLeituras,
    initDB,
    insertPessoas,
    markLeiturasAsSynced,
    saveLeitura,
    clearVeiculos,
    insertVeiculos,
    findVeiculoByPlaca,
    saveLeituraVeiculo,
    getUnsyncedLeiturasVeiculos,
    markLeiturasVeiculosAsSynced
} from "./src/database";

// Paleta fornecida:
// dark: #141926
// blue: #3269D9
// green: #36BF8D
// light: #F2F2F2
// danger: #E74C3C

function bytesToHex(bytes: number[] | Uint8Array) {
  return Array.from(bytes)
    .map((b) => ("00" + (b & 0xff).toString(16)).slice(-2))
    .join("")
    .toUpperCase();
}

function reverseHex(hex: string) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  return (
    clean
      .match(/.{1,2}/g)
      ?.reverse()
      .join("")
      ?.toUpperCase() ?? ""
  );
}

function hexToDec(hex: string) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (!clean) return "0";
  try {
    return BigInt("0x" + clean).toString(10);
  } catch (e) {
    return "0";
  }
}

type Screen = "LOGIN" | "PORTARIA" | "DASHBOARD" | "READING" | "CAMERA_PLACA";

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [hasNfc, setHasNfc] = useState<boolean | null>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>("LOGIN");

  const [url, setUrl] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const [portarias, setPortarias] = useState<any[]>([]);
  const [selectedPortaria, setSelectedPortaria] = useState<any>(null);

  // Sync info
  const [lastSyncPessoas, setLastSyncPessoas] = useState<string | null>(null);
  const [lastSyncLeituras, setLastSyncLeituras] = useState<string | null>(null);
  const [leiturasPendentes, setLeiturasPendentes] = useState<number>(0);
  const [leiturasVeiculosPendentes, setLeiturasVeiculosPendentes] = useState<number>(0);
  const [lastSyncVeiculos, setLastSyncVeiculos] = useState<string | null>(null);
  const [lastSyncLeiturasVeiculos, setLastSyncLeiturasVeiculos] = useState<string | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [placaLida, setPlacaLida] = useState<any>(null);
  const [aguardandoNfcCondutor, setAguardandoNfcCondutor] = useState(false);
  const [modoPassageiros, setModoPassageiros] = useState(false);
  const modoPassageirosRef = useRef(false);
  const setModoPassageirosSync = (val: boolean) => {
    modoPassageirosRef.current = val;
    setModoPassageiros(val);
  };
  const [sentidoVeiculo, setSentidoVeiculo] = useState<"ENTRADA" | "SAIDA">("ENTRADA");
  const [zoom, setZoom] = useState(0);
  const [mostrarBuscaManual, setMostrarBuscaManual] = useState(false);
  const [placaInput, setPlacaInput] = useState("");
  const [cameraLayout, setCameraLayout] = useState<{ width: number; height: number } | null>(null);


  const refreshPendingLeituras = async () => {
    try {
      const unsynced = await getUnsyncedLeituras();
      setLeiturasPendentes(unsynced.length);
      const unsyncedV = await getUnsyncedLeiturasVeiculos();
      setLeiturasVeiculosPendentes(unsyncedV.length);
    } catch (e) {
      console.warn("Erro ao carregar leituras pendentes:", e);
    }
  };

  // Leitura status
  const [lastRead, setLastRead] = useState<any>(null);
  const lastReadTimeRef = useRef<number>(0);
  const lastTagIdRef = useRef<string | null>(null);
  const soundRefs = useRef<{
    success?: ExpoAudio.Sound;
    error?: ExpoAudio.Sound;
  }>({});

  // Controle de Lembrete de Sincronização
  const lastPromptTimeRef = useRef<number>(0);
  const isSyncPromptingRef = useRef<boolean>(false);

  useEffect(() => {
    async function setup() {
      try {
        await initDB();
        setIsDbReady(true);
        const savedUrl = await getApiUrl();
        setUrl(savedUrl);
        const token = await SecureStore.getItemAsync("user_token");
        const pStr = await SecureStore.getItemAsync("selected_portaria");
        if (token && pStr) {
          setSelectedPortaria(JSON.parse(pStr));
          setCurrentScreen("DASHBOARD");
        } else if (pStr) {
          setSelectedPortaria(JSON.parse(pStr));
        }
        // Carregar última sincronização
        const lastPessoas = await SecureStore.getItemAsync("last_sync_pessoas");
        if (lastPessoas) setLastSyncPessoas(lastPessoas);
        const lastLeituras = await SecureStore.getItemAsync("last_sync_leituras");
        if (lastLeituras) setLastSyncLeituras(lastLeituras);
        
        const lastVeiculos = await SecureStore.getItemAsync("last_sync_veiculos");
        if (lastVeiculos) setLastSyncVeiculos(lastVeiculos);

        const lastLeiturasVeic = await SecureStore.getItemAsync("last_sync_leituras_veiculos");
        if (lastLeiturasVeic) setLastSyncLeiturasVeiculos(lastLeiturasVeic);

        await refreshPendingLeituras();
      } catch (err) {
        console.error("DB Init error", err);
        Alert.alert(
          "Erro",
          "Falha ao inicializar o banco de dados. Por favor, reinicie o aplicativo.",
        );
      }
    }
    setup();

    async function initNfc() {
      try {
        const supported = await NfcManager.isSupported();
        if (!supported) {
          setHasNfc(false);
          return;
        }

        await NfcManager.start();
        const enabled = await NfcManager.isEnabled();
        setHasNfc(enabled);
      } catch (e) {
        console.warn("Nfc erro:", e);
        setHasNfc(false);
      }
    }

    async function initAudio() {
      try {
        await ExpoAudio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn("Audio load erro:", e);
      }
    }

    initNfc();
    initAudio();

    return () => {
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    };
  }, []);

  // Lembrete periódico de sincronização (de hora em hora)
  useEffect(() => {
    if (currentScreen !== "DASHBOARD") return;

    const checkAndPromptSync = async () => {
      if (isSyncPromptingRef.current || loading) return;

      try {
        const lastSyncTsStr = await SecureStore.getItemAsync("last_sync_timestamp");
        const now = Date.now();

        let needSync = false;
        if (!lastSyncTsStr) {
          needSync = true;
        } else {
          const lastSyncTs = parseInt(lastSyncTsStr, 10);
          const oneHour = 60 * 60 * 1000;
          if (now - lastSyncTs > oneHour) {
            if (now - lastPromptTimeRef.current > oneHour) {
              needSync = true;
            }
          }
        }

        if (needSync) {
          isSyncPromptingRef.current = true;
          Alert.alert(
            "Lembrete de Atualização",
            "Faz mais de 1 hora desde a última sincronização de cadastros. Deseja atualizar os dados da API para o celular agora?",
            [
              {
                text: "Adiar",
                style: "cancel",
                onPress: () => {
                  lastPromptTimeRef.current = Date.now();
                  isSyncPromptingRef.current = false;
                }
              },
              {
                text: "Atualizar Agora",
                onPress: async () => {
                  isSyncPromptingRef.current = false;
                  await syncDataAPItoMobile();
                }
              }
            ],
            { cancelable: false }
          );
        }
      } catch (err) {
        console.warn("Erro ao verificar lembrete de sincronização:", err);
      }
    };

    // Verifica ao carregar o dashboard/abrir app
    checkAndPromptSync();

    // Roda um timer para verificar a cada 1 minuto
    const intervalId = setInterval(checkAndPromptSync, 60 * 1000);

    return () => clearInterval(intervalId);
  }, [currentScreen, loading]);

  const handleLogin = async () => {
    if (!url || !login || !senha)
      return Alert.alert("Erro", "Preencha todos os campos");
    setLoading(true);
    try {
      await setApiUrl(url);
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, senha }),
      });

      if (res.usuario.perfil !== "MOBILE" && res.usuario.perfil !== "MASTER") {
        Alert.alert("Erro", "Perfil sem acesso mobile.");
        setLoading(false);
        return;
      }

      await setToken(res.token);

      // Get Portarias
      const ports = await apiFetch("/portarias");
      setPortarias(ports);
      setCurrentScreen("PORTARIA");
    } catch (err: any) {
      Alert.alert("Erro no Login", err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectPortaria = async (portaria: any) => {
    await SecureStore.setItemAsync(
      "selected_portaria",
      JSON.stringify(portaria),
    );
    setSelectedPortaria(portaria);
    setCurrentScreen("DASHBOARD");
  };

  const syncDataAPItoMobile = async () => {
    setLoading(true);
    try {
      // Sync Pessoas
      const pessoas = await apiFetch("/pessoas");
      await clearPessoas();
      await insertPessoas(pessoas);
      const nowPessoas = new Date().toLocaleString("pt-BR");
      setLastSyncPessoas(nowPessoas);
      await SecureStore.setItemAsync("last_sync_pessoas", nowPessoas);

      // Sync Veiculos
      const veiculos = await apiFetch("/veiculos");
      await clearVeiculos();
      await insertVeiculos(veiculos);
      const nowVeiculos = new Date().toLocaleString("pt-BR");
      setLastSyncVeiculos(nowVeiculos);
      await SecureStore.setItemAsync("last_sync_veiculos", nowVeiculos);

      // Salvar timestamp para controle de lembrete
      await SecureStore.setItemAsync("last_sync_timestamp", Date.now().toString());

      Alert.alert(
        "Sucesso",
        `Cadastros atualizados (API -> Celular).\nPessoas: ${pessoas.length}\nVeículos: ${veiculos.length}`
      );
    } catch (err: any) {
      Alert.alert("Erro na Sincronização", err.message);
    } finally {
      setLoading(false);
    }
  };

  const syncDataMobiletoAPI = async () => {
    setLoading(true);
    try {
      let leiturasMsg = "Nenhuma pessoa pendente.";
      let veiculosMsg = "Nenhum veículo pendente.";
      let syncedSomething = false;

      // Sync Leituras Pessoas
      const unsyncedPessoas = await getUnsyncedLeituras();
      if (unsyncedPessoas.length > 0) {
        const payloadPessoas = unsyncedPessoas.map((u) => ({
          credencial: u.credencial,
          id_portaria: u.id_portaria,
          data_hora_leitura: u.data_hora_leitura,
          id_celular: u.id_celular,
          situacao: u.situacao,
        }));

        const resPessoas = await apiFetch("/sync", {
          method: "POST",
          body: JSON.stringify({ leituras: payloadPessoas }),
        });

        const idsPessoas = unsyncedPessoas.map((u) => u.id);
        await markLeiturasAsSynced(idsPessoas);
        setLeiturasPendentes(0);

        const now = new Date().toLocaleString("pt-BR");
        setLastSyncLeituras(now);
        await SecureStore.setItemAsync("last_sync_leituras", now);
        leiturasMsg = `${resPessoas.count} leituras de pessoas.`;
        syncedSomething = true;
      }

      // Sync Leituras Veiculos
      const unsyncedVeiculos = await getUnsyncedLeiturasVeiculos();
      if (unsyncedVeiculos.length > 0) {
        const payloadVeiculos = unsyncedVeiculos.map((u) => ({
          id: u.id,
          placa: u.placa,
          matricula_condutor: u.matricula_condutor,
          nome_condutor: u.nome_condutor,
          credencial_condutor: u.credencial_condutor,
          id_portaria: u.id_portaria,
          sentido: u.sentido,
          data_hora_leitura: u.data_hora_leitura,
          id_celular: u.id_celular,
          situacao: u.situacao,
          is_condutor: u.is_condutor === 1,
        }));

        const resVeiculos = await apiFetch("/sync/leituras-veiculo", {
          method: "POST",
          body: JSON.stringify({ leituras: payloadVeiculos }),
        });

        const idsVeiculos = unsyncedVeiculos.map((u) => u.id);
        await markLeiturasVeiculosAsSynced(idsVeiculos);
        setLeiturasVeiculosPendentes(0);

        const now = new Date().toLocaleString("pt-BR");
        setLastSyncLeiturasVeiculos(now);
        await SecureStore.setItemAsync("last_sync_leituras_veiculos", now);
        veiculosMsg = `${resVeiculos.count} leituras de veículos.`;
        syncedSomething = true;
      }

      if (syncedSomething) {
        Alert.alert(
          "Sucesso",
          `Envio concluído (Celular -> API).\n\nEnviados:\n- ${leiturasMsg}\n- ${veiculosMsg}`
        );
      } else {
        Alert.alert("Sincronização", "Nenhum registro pendente para envio.");
      }
    } catch (err: any) {
      Alert.alert("Erro na Sincronização", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Deseja realmente sair do aplicativo?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair",
        style: "destructive",
        onPress: async () => {
          await setToken("");
          await SecureStore.deleteItemAsync("selected_portaria");
          setSelectedPortaria(null);
          setCurrentScreen("LOGIN");
          setLogin("");
          setSenha("");
        },
      },
    ]);
  };

  const playFeedbackSound = async (allowed: boolean) => {
    // Pequeno delay de 350ms para permitir que o sistema operacional Android finalize a liberação dos recursos
    // de hardware e foco de áudio da câmera (shutter sound) antes de abrirmos a nossa sessão de áudio.
    setTimeout(async () => {
      try {
        // Força a redefinição do modo de áudio do Expo para resgatar o foco de áudio do sistema
        await ExpoAudio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });

        const soundFile = allowed 
          ? require("./assets/sounds/allowed.wav") 
          : require("./assets/sounds/blocked.wav");

        // Cria a instância do som diretamente e a executa
        const { sound } = await ExpoAudio.Sound.createAsync(
          soundFile,
          { shouldPlay: true, volume: 1.0 }
        );

        // Descarrega o som da memória quando terminar de tocar para liberar recursos
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync().catch((err) => console.log("Erro ao descarregar som:", err));
          }
        });
      } catch (e) {
        console.warn("Erro ao reproduzir som de feedback:", e);
      }
    }, 350);
  };

  const startReadingMode = async () => {
    if (hasNfc === null) {
      Alert.alert(
        "Aguarde",
        "Verificando o NFC. Por favor, tente novamente em alguns segundos.",
      );
      return;
    }

    if (!hasNfc) {
      Alert.alert("Erro", "NFC não suportado ou desativado neste dispositivo.");
      return;
    }

    setLastRead(null);
    setCurrentScreen("READING");

    NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: any) => {
      const now = Date.now();
      let tagSignature = "";
      if (tag.id) {
        if (Array.isArray(tag.id) || tag.id instanceof Uint8Array) {
          tagSignature = bytesToHex(tag.id as any);
        } else if (typeof tag.id === "string") {
          tagSignature = tag.id.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
        }
      }

      if (tagSignature && tagSignature === lastTagIdRef.current) {
        if (now - lastReadTimeRef.current < 800) return;
      } else if (now - lastReadTimeRef.current < 400) {
        return;
      }

      lastReadTimeRef.current = now;
      lastTagIdRef.current = tagSignature;

      let hex = "";
      if (tagSignature) {
        hex = tagSignature;
      }

      const reversedHex = reverseHex(hex);
      const reversedDec = hexToDec(reversedHex);

      // Search DB
      const pessoa = await findPessoaByCredencial(reversedDec);

      const situacaoCode = pessoa ? pessoa.situacao : 0; // 0 = Bloqueado (não encontrado)
      const nome = pessoa ? pessoa.nome : "Não Cadastrado";
      const matricula = pessoa ? pessoa.matricula : "-";

      const readData = {
        credencial: reversedDec,
        nome,
        matricula,
        situacao: situacaoCode,
        data_hora: new Date().toISOString(),
      };

      setLastRead(readData);

      // Save to local DB
      const uuid =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
      const idCelular = Device.osBuildId || "CELULAR_DESCONHECIDO";

      await saveLeitura(
        uuid,
        reversedDec,
        selectedPortaria.id,
        readData.data_hora,
        idCelular,
        situacaoCode,
      );
      await refreshPendingLeituras();
      playFeedbackSound(situacaoCode === 1);
    });

    try {
      await NfcManager.registerTagEvent();
    } catch (e) {
      console.warn("registerTagEvent err", e);
    }
  };

  const stopReadingMode = () => {
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    NfcManager.unregisterTagEvent().catch(() => {});
    setCurrentScreen("DASHBOARD");
  };

  const capturarPlaca = async () => {
    if (!cameraRef.current) return;
    try {
      setLoading(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        skipMetadata: false,
      });

      // Funções locais de processamento de texto
      const getCandidates = (text: string): string[] => {
        const candidates: string[] = [];
        const words = text.toUpperCase().split(/[\s\n\r]+/);
        const forbidden = ["MERCO", "COSUL", "BRASIL", "BRASI", "ERCOS", "ESUL", "VELOC", "ELOCI", "CONTRO"];
        const isForbidden = (str: string) => {
          return forbidden.some(f => str.includes(f));
        };
        
        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          const cleaned = word.replace(/[^A-Z0-9]/g, "");
          if (cleaned.length >= 7) {
            for (let j = 0; j <= cleaned.length - 7; j++) {
              const candidate = cleaned.substring(j, j + 7);
              if (!isForbidden(candidate)) {
                candidates.push(candidate);
              }
            }
          }
        }
        
        for (let i = 0; i < words.length - 1; i++) {
          const wordA = words[i].replace(/[^A-Z0-9]/g, "");
          const wordB = words[i + 1].replace(/[^A-Z0-9]/g, "");
          if (wordA.length + wordB.length === 7) {
            if ((wordA.length === 3 && wordB.length === 4) || (wordA.length === 4 && wordB.length === 3)) {
              const candidate = wordA + wordB;
              if (!isForbidden(candidate)) {
                candidates.push(candidate);
              }
            }
          }
        }
        
        return candidates;
      };

      const scoreCandidate = (str: string): number => {
        if (str.length !== 7) return -1;
        let score = 0;
        for (let i = 0; i < 3; i++) {
          if (/[A-Z]/i.test(str[i])) score += 2;
          else if (/[01258]/.test(str[i])) score += 1;
        }
        if (/[0-9]/.test(str[3])) score += 2;
        else if (/[OQDLJTzSbB]/i.test(str[3])) score += 1;
        if (/[A-Z]/i.test(str[4])) score += 2;
        else if (/[01258]/.test(str[4])) score += 1;
        for (let i = 5; i < 7; i++) {
          if (/[0-9]/.test(str[i])) score += 2;
          else if (/[OQDLJTzSbB]/i.test(str[i])) score += 1;
        }
        const isLet = (c: string) => /[A-Z]/i.test(c);
        const isNum = (c: string) => /[0-9]/.test(c);
        if (isLet(str[0]) && isLet(str[1]) && isLet(str[2]) && isNum(str[3]) && isLet(str[4]) && isNum(str[5]) && isNum(str[6])) {
          score += 10;
        }
        return score;
      };

      const correctPlate = (str: string): string => {
        str = str.toUpperCase();
        const forceLetter = (char: string) => {
          const map: { [key: string]: string } = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B' };
          return map[char] || char;
        };
        const forceNumber = (char: string) => {
          const map: { [key: string]: string } = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'J': '1', 'T': '1', 'Z': '2', 'S': '5', 'B': '8' };
          return map[char] || char;
        };
        const pos0 = forceLetter(str[0]);
        const pos1 = forceLetter(str[1]);
        const pos2 = forceLetter(str[2]);
        const pos3 = forceNumber(str[3]);
        const pos4 = forceLetter(str[4]);
        const pos5 = forceNumber(str[5]);
        const pos6 = forceNumber(str[6]);
        return `${pos0}${pos1}${pos2}${pos3}${pos4}${pos5}${pos6}`;
      };

      const generatePlateVariants = (str: string): string[] => {
        if (str.length !== 7) return [];
        str = str.toUpperCase();
        const getLetterOptions = (char: string): string[] => {
          if (['O', 'D', 'Q', '0'].includes(char)) return ['O', 'D', 'Q'];
          if (['I', 'L', 'J', 'T', '1'].includes(char)) return ['I', 'L', 'J', 'T'];
          if (['Z', '2'].includes(char)) return ['Z'];
          if (['S', '5'].includes(char)) return ['S'];
          if (['B', '8'].includes(char)) return ['B'];
          if (['G', '6'].includes(char)) return ['G'];
          if (['A', '4'].includes(char)) return ['A'];
          if (['W', 'H', 'M', 'N', 'V', 'U', 'Y'].includes(char)) return ['W', 'H', 'M', 'N', 'V', 'U', 'Y'];
          return [char];
        };
        const getNumberOptions = (char: string): string[] => {
          if (['0', 'O', 'D', 'Q'].includes(char)) return ['0'];
          if (['1', 'I', 'L', 'J', 'T'].includes(char)) return ['1'];
          if (['2', 'Z'].includes(char)) return ['2'];
          if (['5', 'S'].includes(char)) return ['5'];
          if (['8', 'B'].includes(char)) return ['8'];
          if (['6', 'G'].includes(char)) return ['6'];
          if (['4', 'A'].includes(char)) return ['4'];
          return [char];
        };
        const pos0Opts = getLetterOptions(str[0]);
        const pos1Opts = getLetterOptions(str[1]);
        const pos2Opts = getLetterOptions(str[2]);
        const pos3Opts = getNumberOptions(str[3]);
        const pos6Opts = getNumberOptions(str[6]);
        const pos4Opts = getLetterOptions(str[4]);
        const pos5Opts = getNumberOptions(str[5]);
        const variantsSet = new Set<string>();
        for (const p0 of pos0Opts) {
          for (const p1 of pos1Opts) {
            for (const p2 of pos2Opts) {
              for (const p3 of pos3Opts) {
                for (const p4 of pos4Opts) {
                  for (const p5 of pos5Opts) {
                    for (const p6 of pos6Opts) {
                      variantsSet.add(`${p0}${p1}${p2}${p3}${p4}${p5}${p6}`);
                    }
                  }
                }
              }
            }
          }
        }
        return Array.from(variantsSet);
      };

      const isValidMercosulCar = (str: string): boolean => {
        if (str.length !== 7) return false;
        const isLet = (c: string) => /[A-Z]/.test(c);
        const isNum = (c: string) => /[0-9]/.test(c);
        return isLet(str[0]) && isLet(str[1]) && isLet(str[2]) && isNum(str[3]) && isLet(str[4]) && isNum(str[5]) && isNum(str[6]);
      };

      let scoredCandidates: any[] = [];

      // TENTATIVA 1: Processamento da região recortada e redimensionada da placa
      try {
        let originX = photo.width * 0.14;
        let originY = photo.height * 0.38;
        let cropWidth = photo.width * 0.72;
        let cropHeight = photo.height * 0.15;

        if (cameraLayout) {
          const lw = cameraLayout.width;
          const lh = cameraLayout.height;
          const pw = photo.width;
          const ph = photo.height;

          const rLayout = lw / lh;
          const rPhoto = pw / ph;

          let scale = 1;
          let xOffset = 0;
          let yOffset = 0;

          if (rLayout > rPhoto) {
            // Layout é mais largo que a foto (Cover corta topo/fundo)
            scale = lw / pw;
            yOffset = (ph * scale - lh) / 2;
          } else {
            // Layout é mais alto que a foto (Cover corta laterais)
            scale = lh / ph;
            xOffset = (pw * scale - lw) / 2;
          }

          // Posição visual do retângulo verde na tela (layout)
          const boxWidthLayout = 280;
          const boxHeightLayout = 110;
          const boxXLayout = (lw - boxWidthLayout) / 2;
          const boxYLayout = (lh - boxHeightLayout) * (1 / 2.8);

          // Mapeamento para coordenadas da foto real
          const mappedX = (boxXLayout + xOffset) / scale;
          const mappedY = (boxYLayout + yOffset) / scale;
          const mappedW = boxWidthLayout / scale;
          const mappedH = boxHeightLayout / scale;

          // Limita as coordenadas para não estourarem as dimensões da foto
          originX = Math.max(0, Math.min(pw - 10, mappedX));
          originY = Math.max(0, Math.min(ph - 10, mappedY));
          cropWidth = Math.max(10, Math.min(pw - originX, mappedW));
          cropHeight = Math.max(10, Math.min(ph - originY, mappedH));

          console.log(`[Crop preciso] Mapeado: X=${originX.toFixed(0)}, Y=${originY.toFixed(0)}, W=${cropWidth.toFixed(0)}, H=${cropHeight.toFixed(0)} | Foto: ${pw}x${ph} | Layout: ${lw}x${lh}`);
        }

        const manipulatedPhoto = await ImageManipulator.manipulateAsync(
          photo.uri,
          [
            {
              crop: {
                originX: Math.round(originX),
                originY: Math.round(originY),
                width: Math.round(cropWidth),
                height: Math.round(cropHeight),
              },
            },
            {
              resize: {
                width: 800,
              },
            },
          ],
          {
            compress: 1,
            format: ImageManipulator.SaveFormat.JPEG,
          }
        );

        const result = await TextRecognition.recognize(manipulatedPhoto.uri);
        const allText = result.blocks.map(b => b.text).join(" ");
        const candidates = getCandidates(allText);
        
        scoredCandidates = candidates
          .map(c => {
            const corrected = correctPlate(c);
            return { raw: c, corrected, score: scoreCandidate(corrected) };
          })
          .filter(x => isValidMercosulCar(x.corrected) && x.score >= 14)
          .sort((a, b) => b.score - a.score);
      } catch (cropErr) {
        console.warn("Erro no processamento do recorte, tentando imagem cheia:", cropErr);
      }

      // TENTATIVA 2 (FALLBACK): Se o recorte falhar ou não encontrar candidatos válidos, processamos a imagem completa
      if (scoredCandidates.length === 0) {
        try {
          console.log("Nenhuma placa detectada no recorte. Rodando OCR na imagem completa...");
          
          // Opcional: Redimensiona a foto cheia ligeiramente para otimizar velocidade do OCR do ML Kit
          const fullResized = await ImageManipulator.manipulateAsync(
            photo.uri,
            [{ resize: { width: 1200 } }],
            { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
          );

          const resultFull = await TextRecognition.recognize(fullResized.uri);
          const allTextFull = resultFull.blocks.map(b => b.text).join(" ");
          const candidatesFull = getCandidates(allTextFull);
          
          scoredCandidates = candidatesFull
            .map(c => {
              const corrected = correctPlate(c);
              return { raw: c, corrected, score: scoreCandidate(corrected) };
            })
            .filter(x => isValidMercosulCar(x.corrected) && x.score >= 14)
            .sort((a, b) => b.score - a.score);
        } catch (fullErr) {
          console.warn("Erro no processamento da imagem completa:", fullErr);
        }
      }

      let placaEncontrada = "";
      let veiculo = null;

      // Primeiro tentamos achar um veículo no banco comparando as placas corrigidas e suas variantes
      for (const item of scoredCandidates) {
        const variants = generatePlateVariants(item.corrected);
        let found = null;
        for (const variant of variants) {
          found = await findVeiculoByPlaca(variant);
          if (found) {
            placaEncontrada = variant;
            veiculo = found;
            break;
          }
        }
        if (veiculo) break;
      }

      // Se nenhum veículo do banco coincidir, pegamos a melhor placa candidata corrigida
      if (!placaEncontrada && scoredCandidates.length > 0) {
        placaEncontrada = scoredCandidates[0].corrected;
      }

      if (!placaEncontrada) {
        Alert.alert("Erro", "Nenhuma placa identificada na imagem. Tente novamente.");
        setLoading(false);
        return;
      }

      if (!veiculo) {
        veiculo = await findVeiculoByPlaca(placaEncontrada);
      }

      if (!veiculo) {
        playFeedbackSound(false);
        Alert.alert("Bloqueado", `Placa ${placaEncontrada} não encontrada no cadastro de veículos.`);
        setLoading(false);
        return;
      }

      setPlacaLida(veiculo);
      setAguardandoNfcCondutor(true);
      playFeedbackSound(true);

      NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: any) => {
        try {
          const now = Date.now();
          if (now - lastReadTimeRef.current < 1000) return;
          lastReadTimeRef.current = now;

          let tagSignature = "";
          if (tag.id) {
            if (Array.isArray(tag.id) || tag.id instanceof Uint8Array) {
              tagSignature = bytesToHex(tag.id as any);
            } else if (typeof tag.id === "string") {
              tagSignature = tag.id.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
            }
          }

          const reversedHex = reverseHex(tagSignature);
          const reversedDec = hexToDec(reversedHex);

          const pessoa = await findPessoaByCredencial(reversedDec);
          const situacaoCode = pessoa ? pessoa.situacao : 0;
          const nome = pessoa ? pessoa.nome : "Não Cadastrado";
          const matricula = pessoa ? pessoa.matricula : "-";

          const uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          const idCelular = Device.osBuildId || "CELULAR_DESCONHECIDO";

          const isCondutorVal = !modoPassageirosRef.current ? 1 : 0;

          await saveLeituraVeiculo(
            uuid,
            veiculo.placa,
            matricula,
            nome,
            reversedDec,
            selectedPortaria.id,
            sentidoVeiculo,
            new Date().toISOString(),
            idCelular,
            situacaoCode,
            isCondutorVal
          );

          playFeedbackSound(situacaoCode === 1);
          await refreshPendingLeituras();

          const wasCondutor = !modoPassageirosRef.current;
          setLastRead({
            situacao: situacaoCode,
            nome: nome,
            matricula: matricula,
            credencial: reversedDec,
            is_condutor: wasCondutor
          });
          if (wasCondutor) {
            setModoPassageirosSync(true);
          }
        } catch (err: any) {
          playFeedbackSound(false);
          Alert.alert("Erro ao ler cartão", err.message);
        }
      });

      await NfcManager.registerTagEvent();

    } catch (e: any) {
      Alert.alert("Erro ao capturar placa", e.message);
    } finally {
      setLoading(false);
    }
  };

  const stopCameraMode = () => {
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    NfcManager.unregisterTagEvent().catch(() => {});
    setPlacaLida(null);
    setAguardandoNfcCondutor(false);
    setModoPassageirosSync(false);
    setLastRead(null);
    setZoom(0);
    setMostrarBuscaManual(false);
    setPlacaInput("");
    
    // Força a restauração do modo de áudio ao sair da tela de câmera para garantir que o som do Modo 2 seja restaurado
    ExpoAudio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(err => console.log("Erro ao resetar modo de áudio:", err));

    setCurrentScreen("DASHBOARD");
  };

  const buscarPlacaManualmente = async () => {
    if (!placaInput || placaInput.trim().length < 7) {
      Alert.alert("Aviso", "Por favor, digite uma placa válida com 7 caracteres.");
      return;
    }

    const placaNormalizada = placaInput.trim().toUpperCase();
    setLoading(true);
    try {
      const veiculo = await findVeiculoByPlaca(placaNormalizada);
      if (!veiculo) {
        playFeedbackSound(false);
        Alert.alert("Bloqueado", `Placa ${placaNormalizada} não encontrada no cadastro de veículos.`);
        setLoading(false);
        return;
      }

      setPlacaLida(veiculo);
      setAguardandoNfcCondutor(true);
      setMostrarBuscaManual(false);
      setPlacaInput("");
      playFeedbackSound(true);

      NfcManager.setEventListener(NfcEvents.DiscoverTag, async (tag: any) => {
        try {
          const now = Date.now();
          if (now - lastReadTimeRef.current < 1000) return;
          lastReadTimeRef.current = now;

          let tagSignature = "";
          if (tag.id) {
            if (Array.isArray(tag.id) || tag.id instanceof Uint8Array) {
              tagSignature = bytesToHex(tag.id as any);
            } else if (typeof tag.id === "string") {
              tagSignature = tag.id.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
            }
          }

          const reversedHex = reverseHex(tagSignature);
          const reversedDec = hexToDec(reversedHex);

          const pessoa = await findPessoaByCredencial(reversedDec);
          const situacaoCode = pessoa ? pessoa.situacao : 0;
          const nome = pessoa ? pessoa.nome : "Não Cadastrado";
          const matricula = pessoa ? pessoa.matricula : "-";

          const uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          const idCelular = Device.osBuildId || "CELULAR_DESCONHECIDO";

          const isCondutorVal = !modoPassageirosRef.current ? 1 : 0;

          await saveLeituraVeiculo(
            uuid,
            veiculo.placa,
            matricula,
            nome,
            reversedDec,
            selectedPortaria.id,
            sentidoVeiculo,
            new Date().toISOString(),
            idCelular,
            situacaoCode,
            isCondutorVal
          );

          playFeedbackSound(situacaoCode === 1);
          await refreshPendingLeituras();

          const wasCondutor = !modoPassageirosRef.current;
          setLastRead({
            situacao: situacaoCode,
            nome: nome,
            matricula: matricula,
            credencial: reversedDec,
            is_condutor: wasCondutor
          });
          if (wasCondutor) {
            setModoPassageirosSync(true);
          }
        } catch (err: any) {
          playFeedbackSound(false);
          Alert.alert("Erro ao ler cartão", err.message);
        }
      });

      await NfcManager.registerTagEvent();

    } catch (e: any) {
      Alert.alert("Erro ao buscar veículo", e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isDbReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3269D9" />
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CPRT Acesso</Text>
        {selectedPortaria &&
          currentScreen !== "LOGIN" &&
          currentScreen !== "PORTARIA" && (
            <Text style={styles.headerSubtitle}>
              Portaria: {selectedPortaria.descricao}
            </Text>
          )}
      </View>

      {/* LOGIN SCREEN */}
      {currentScreen === "LOGIN" && (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Login Agente</Text>

            <Text style={styles.label}>URL da API</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Usuário</Text>
            <TextInput
              style={styles.input}
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Senha</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={senha}
                onChangeText={setSenha}
                secureTextEntry={!passwordVisible}
                textContentType="password"
                autoComplete="password"
                keyboardType="default"
                placeholder="Digite sua senha"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setPasswordVisible((prev) => !prev)}
              >
                <Text style={styles.toggleButtonText}>
                  {passwordVisible ? "Ocultar" : "Mostrar"}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.button}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* PORTARIA SCREEN */}
      {currentScreen === "PORTARIA" && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.cardTitle}>Selecione a Portaria</Text>
          {portarias.map((p, index) => (
            <TouchableOpacity
              key={index}
              style={styles.portariaCard}
              onPress={() => selectPortaria(p)}
            >
              <Text style={styles.portariaText}>{p.descricao}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* DASHBOARD SCREEN */}
      {currentScreen === "DASHBOARD" && (
        <ScrollView contentContainerStyle={styles.container}>
          {/* Info de sincronização */}
          <View style={styles.syncInfoCard}>
            <Text style={styles.syncInfoTitle}>
              Informações de Sincronização
            </Text>
            <Text style={styles.syncInfoText}>
              Pessoas (API→Celular): {lastSyncPessoas || "Nunca sincronizado"}
            </Text>
            <Text style={styles.syncInfoText}>
              Leituras (Celular→API): {lastSyncLeituras || "Nunca sincronizado"}
            </Text>
            <Text style={styles.syncInfoText}>
              Registros pendentes: {leiturasPendentes}
            </Text>
            <View style={{height: 1, backgroundColor: '#ccc', marginVertical: 8}}/>
            <Text style={styles.syncInfoText}>
              Veículos (API→Celular): {lastSyncVeiculos || "Nunca sincronizado"}
            </Text>
            <Text style={styles.syncInfoText}>
              Leituras Veículo (Celular→API): {lastSyncLeiturasVeiculos || "Nunca sincronizado"}
            </Text>
            <Text style={styles.syncInfoText}>
              Leituras Veículo Pendentes: {leiturasVeiculosPendentes}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.dashboardBtn, { backgroundColor: "#36BF8D" }]}
            onPress={syncDataAPItoMobile}
            disabled={loading}
          >
            <Text style={styles.dashboardBtnText}>
              1. Baixar Cadastros (API {"->"} Celular)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.dashboardBtn,
              { backgroundColor: "#3269D9", marginTop: 20 },
            ]}
            onPress={startReadingMode}
            disabled={loading || hasNfc === null}
          >
            <Text style={styles.dashboardBtnText}>
              2. Modo Leitura de Cartão
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.dashboardBtn,
              { backgroundColor: "#2980B9", marginTop: 20 },
            ]}
            onPress={async () => {
              if (!cameraPermission?.granted) {
                const p = await requestCameraPermission();
                if (!p.granted) return Alert.alert("Erro", "Permissão de câmera negada");
              }
              if (hasNfc === null) {
                return Alert.alert("Aguarde", "Verificando NFC...");
              }
              setPlacaLida(null);
              setAguardandoNfcCondutor(false);
              setModoPassageirosSync(false);
              setLastRead(null);
              setCurrentScreen("CAMERA_PLACA");
            }}
            disabled={loading}
          >
            <Text style={styles.dashboardBtnText}>
              3. Modo Leitura de Placa e Cartão
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.dashboardBtn,
              { backgroundColor: "#F39C12", marginTop: 20 },
            ]}
            onPress={syncDataMobiletoAPI}
            disabled={loading}
          >
            <Text style={styles.dashboardBtnText}>
              4. Enviar Leituras (Celular {"->"} API)
            </Text>
          </TouchableOpacity>

          {loading && (
            <ActivityIndicator
              size="large"
              color="#3269D9"
              style={{ marginTop: 20 }}
            />
          )}

          <View style={styles.dashboardFooter}>
            <TouchableOpacity
              style={styles.footerBtn}
              onPress={() => setCurrentScreen("PORTARIA")}
            >
              <Text style={styles.footerBtnText}>Trocar Portaria</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: "#E74C3C" }]}
              onPress={handleLogout}
            >
              <Text style={styles.footerBtnText}>Sair (Logout)</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* READING SCREEN */}
      {currentScreen === "READING" && (
        <View style={styles.readingContainer}>
          <View style={styles.readingTop}>
            <Text style={styles.pulseText}>Aproxime o cartão NFC...</Text>
            <Text style={styles.pulseSubText}>
              Modo contínuo ativo. Leia os cartões um após o outro.
            </Text>
          </View>

          <View style={styles.resultArea}>
            {lastRead ? (
              <View
                style={[
                  styles.resultCard,
                  {
                    borderColor:
                      lastRead.situacao === 1 ? "#36BF8D" : "#E74C3C",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.resultStatus,
                    { color: lastRead.situacao === 1 ? "#36BF8D" : "#E74C3C" },
                  ]}
                >
                  {lastRead.situacao === 1
                    ? "ACESSO PERMITIDO"
                    : "ACESSO BLOQUEADO"}
                </Text>
                <Text style={styles.resultLabel}>Nome:</Text>
                <Text style={styles.resultValue}>{lastRead.nome}</Text>

                <Text style={styles.resultLabel}>Matrícula:</Text>
                <Text style={styles.resultValue}>{lastRead.matricula}</Text>

                <Text style={styles.resultLabel}>Credencial (R-DEC):</Text>
                <Text style={styles.resultValue}>{lastRead.credencial}</Text>
              </View>
            ) : (
              <Text style={{ color: "#aaa", fontSize: 16 }}>
                Nenhuma leitura realizada ainda.
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#E74C3C", margin: 20 }]}
            onPress={stopReadingMode}
          >
            <Text style={styles.buttonText}>Sair do Modo Leitura</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* CAMERA SCREEN */}
      {currentScreen === "CAMERA_PLACA" && (
        <View style={styles.readingContainer}>
          <View style={styles.readingTop}>
            <Text style={styles.pulseText}>Leitura de Veículos</Text>
            <Text style={styles.pulseSubText}>
              {aguardandoNfcCondutor 
                ? (modoPassageiros ? `Veículo ${placaLida?.placa}. Lendo Passageiros.` : `Placa Lida: ${placaLida?.placa}. Aproxime o cartão do condutor.`) 
                : "Centralize a placa e capture a imagem."}
            </Text>
          </View>

          <View style={{ flex: 1, backgroundColor: "#000", overflow: "hidden", position: 'relative' }}>
            {!aguardandoNfcCondutor ? (
              <CameraView 
                style={{ flex: 1 }} 
                facing="back" 
                ref={cameraRef}
                zoom={zoom}
                mute={true}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setCameraLayout({ width, height });
                }}
              >
                {/* Visual Guide Rectangle Overlay */}
                <View style={styles.overlayGuideContainer} pointerEvents="none">
                  <View style={styles.overlayTop} />
                  <View style={styles.overlayMiddleRow}>
                    <View style={styles.overlaySide} />
                    <View style={styles.overlayFocusArea}>
                      <View style={[styles.corner, styles.topLeftCorner]} />
                      <View style={[styles.corner, styles.topRightCorner]} />
                      <View style={[styles.corner, styles.bottomLeftCorner]} />
                      <View style={[styles.corner, styles.bottomRightCorner]} />
                      <Text style={styles.overlayGuideText}>ALINHE A PLACA AQUI</Text>
                    </View>
                    <View style={styles.overlaySide} />
                  </View>
                  <View style={styles.overlayBottom} />
                </View>

                <View style={{ flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end', padding: 20 }}>
                  {/* Zoom Controls */}
                  <View style={styles.zoomContainer}>
                    <TouchableOpacity 
                      style={[styles.zoomButton, zoom === 0 && styles.zoomButtonActive]} 
                      onPress={() => setZoom(0)}
                    >
                      <Text style={[styles.zoomText, zoom === 0 && styles.zoomTextActive]}>1x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.zoomButton, zoom === 0.15 && styles.zoomButtonActive]} 
                      onPress={() => setZoom(0.15)}
                    >
                      <Text style={[styles.zoomText, zoom === 0.15 && styles.zoomTextActive]}>1.5x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.zoomButton, zoom === 0.3 && styles.zoomButtonActive]} 
                      onPress={() => setZoom(0.3)}
                    >
                      <Text style={[styles.zoomText, zoom === 0.3 && styles.zoomTextActive]}>2x</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
                    <TouchableOpacity
                      style={[styles.button, { flex: 1, marginRight: 5, backgroundColor: sentidoVeiculo === "ENTRADA" ? "#217346" : "rgba(33, 115, 70, 0.4)" }]}
                      onPress={() => setSentidoVeiculo("ENTRADA")}
                    >
                      <Text style={styles.buttonText}>ENTRADA</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, { flex: 1, marginLeft: 5, backgroundColor: sentidoVeiculo === "SAIDA" ? "#E74C3C" : "rgba(231, 76, 60, 0.4)" }]}
                      onPress={() => setSentidoVeiculo("SAIDA")}
                    >
                      <Text style={styles.buttonText}>SAÍDA</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
                    <TouchableOpacity
                      style={[styles.button, { flex: 2, marginRight: 5, backgroundColor: "#3269D9" }]}
                      onPress={capturarPlaca}
                      disabled={loading}
                    >
                      {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Capturar Placa</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, { flex: 1, marginLeft: 5, backgroundColor: "#F39C12" }]}
                      onPress={() => {
                        setPlacaInput("");
                        setMostrarBuscaManual(true);
                      }}
                      disabled={loading}
                    >
                      <Text style={styles.buttonText}>Digitar Placa</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </CameraView>
            ) : (
              <View style={styles.resultArea}>
                <View style={[styles.resultCard, { borderColor: "#3269D9" }]}>
                  <Text style={[styles.resultStatus, { color: "#3269D9" }]}>
                    AGUARDANDO NFC
                  </Text>
                  <Text style={styles.resultLabel}>Placa Identificada:</Text>
                  <Text style={styles.resultValue}>{placaLida.placa}</Text>
                  <Text style={styles.resultLabel}>Descrição:</Text>
                  <Text style={styles.resultValue}>{placaLida.descricao}</Text>
                  
                  <Text style={[styles.resultLabel, {marginTop: 20, textAlign: 'center'}]}>
                    {modoPassageiros ? "Aproxime o cartão do PASSAGEIRO." : "Aproxime o cartão do CONDUTOR no sensor NFC do celular."}
                  </Text>
                  
                  {lastRead && (
                    <View
                      style={[
                        styles.resultCard,
                        {
                          borderColor: lastRead.situacao === 1 ? "#36BF8D" : "#E74C3C",
                          marginTop: 15,
                          backgroundColor: "#FFFFFF",
                          padding: 15
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.resultStatus,
                          { color: lastRead.situacao === 1 ? "#36BF8D" : "#E74C3C", fontSize: 16 },
                        ]}
                      >
                        {lastRead.situacao === 1
                          ? `PERMITIDO (${lastRead.is_condutor ? 'CONDUTOR' : 'PASSAGEIRO'})`
                          : `BLOQUEADO (${lastRead.is_condutor ? 'CONDUTOR' : 'PASSAGEIRO'})`}
                      </Text>
                      <Text style={styles.resultLabel}>Nome:</Text>
                      <Text style={[styles.resultValue, {fontSize: 16}]}>{lastRead.nome}</Text>
 
                      <Text style={styles.resultLabel}>Matrícula:</Text>
                      <Text style={[styles.resultValue, {fontSize: 16}]}>{lastRead.matricula}</Text>
 
                      <Text style={styles.resultLabel}>Credencial:</Text>
                      <Text style={[styles.resultValue, {fontSize: 16}]}>{lastRead.credencial}</Text>
                    </View>
                  )}
 
                  {!lastRead && <ActivityIndicator size="large" color="#3269D9" style={{marginTop: 15}} />}
                </View>
                {modoPassageiros && (
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: "#E74C3C", marginTop: 20 }]}
                    onPress={() => {
                      setPlacaLida(null);
                      setAguardandoNfcCondutor(false);
                      setModoPassageirosSync(false);
                      setLastRead(null);
                      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
                    }}
                  >
                    <Text style={styles.buttonText}>Finalizar Veículo e Ler Nova Placa</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Manual Search Modal/Card Overlay */}
            {mostrarBuscaManual && (
              <View style={styles.manualSearchOverlay}>
                <View style={styles.manualSearchCard}>
                  <Text style={styles.manualSearchTitle}>Consulta Manual de Placa</Text>
                  <Text style={styles.manualSearchSubtitle}>
                    Digite a placa do veículo para fazer a verificação e liberação
                  </Text>

                  <TextInput
                    style={styles.manualSearchInput}
                    value={placaInput}
                    onChangeText={(txt) => setPlacaInput(txt.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={7}
                    placeholder="AAA9A99"
                    placeholderTextColor="#888"
                    autoCorrect={false}
                    autoFocus
                  />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <TouchableOpacity
                      style={[styles.button, { flex: 1, marginRight: 5, backgroundColor: "rgba(231, 76, 60, 0.15)", borderWidth: 1, borderColor: "#E74C3C" }]}
                      onPress={() => {
                        setMostrarBuscaManual(false);
                        setPlacaInput("");
                      }}
                    >
                      <Text style={[styles.buttonText, { color: "#E74C3C" }]}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, { flex: 1, marginLeft: 5, backgroundColor: "#36BF8D" }]}
                      onPress={buscarPlacaManualmente}
                      disabled={loading}
                    >
                      {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Buscar</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#E74C3C", margin: 20 }]}
            onPress={stopCameraMode}
          >
            <Text style={styles.buttonText}>Sair</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#141926",
  },
  app: { flex: 1, backgroundColor: "#141926" },
  header: {
    height: 90,
    backgroundColor: "#3269D9",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 15,
  },
  headerTitle: { color: "#F2F2F2", fontSize: 22, fontWeight: "700" },
  headerSubtitle: { color: "#F2F2F2", fontSize: 14, opacity: 0.8 },
  container: { padding: 20 },
  card: { backgroundColor: "#F2F2F2", padding: 20, borderRadius: 8 },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 20,
    color: "#141926",
    textAlign: "center",
  },
  label: { fontSize: 14, color: "#141926", marginBottom: 5, fontWeight: "600" },
  input: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#CCC",
    borderRadius: 6,
    padding: 10,
    marginBottom: 15,
  },
  button: {
    backgroundColor: "#3269D9",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#FFF", fontWeight: "bold", fontSize: 16 },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  passwordInput: {
    flex: 1,
    marginBottom: 0,
  },
  toggleButton: {
    marginLeft: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: "#E0E0E0",
  },
  toggleButtonText: {
    color: "#141926",
    fontWeight: "700",
  },

  portariaCard: {
    backgroundColor: "#F2F2F2",
    padding: 20,
    borderRadius: 8,
    marginBottom: 15,
    alignItems: "center",
  },
  portariaText: { fontSize: 18, color: "#141926", fontWeight: "bold" },

  dashboardBtn: {
    padding: 25,
    borderRadius: 10,
    alignItems: "center",
    elevation: 3,
  },
  dashboardBtnText: { color: "#FFF", fontSize: 16, fontWeight: "bold" },

  syncInfoCard: {
    backgroundColor: "#F2F2F2",
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  syncInfoTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#141926",
    marginBottom: 10,
  },
  syncInfoText: { fontSize: 12, color: "#666", marginBottom: 5 },

  dashboardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
  },
  footerBtn: {
    backgroundColor: "#3269D9",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 5,
    alignItems: "center",
  },
  footerBtnText: { color: "#FFF", fontSize: 14, fontWeight: "bold" },

  readingContainer: { flex: 1, backgroundColor: "#141926" },
  readingTop: {
    padding: 20,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  pulseText: { color: "#36BF8D", fontSize: 18, fontWeight: "bold" },
  pulseSubText: {
    color: "#aaa",
    fontSize: 12,
    marginTop: 5,
    textAlign: "center",
  },

  resultArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  resultCard: {
    backgroundColor: "#F2F2F2",
    padding: 20,
    borderRadius: 10,
    width: "100%",
    borderWidth: 3,
    elevation: 5,
  },
  resultStatus: {
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 20,
  },
  resultLabel: { fontSize: 12, color: "#666", marginTop: 10 },
  resultValue: { fontSize: 18, color: "#141926", fontWeight: "bold" },
  zoomContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 15,
  },
  zoomButton: {
    backgroundColor: 'rgba(20, 25, 38, 0.85)',
    borderWidth: 1,
    borderColor: '#444',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginHorizontal: 8,
    minWidth: 55,
    alignItems: 'center',
  },
  zoomButtonActive: {
    backgroundColor: '#3269D9',
    borderColor: '#3269D9',
  },
  zoomText: {
    color: '#bbb',
    fontWeight: 'bold',
    fontSize: 14,
  },
  zoomTextActive: {
    color: '#FFF',
  },
  overlayGuideContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(20, 25, 38, 0.6)',
  },
  overlayMiddleRow: {
    height: 110,
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(20, 25, 38, 0.6)',
  },
  overlayFocusArea: {
    width: 280,
    height: 110,
    borderWidth: 1.5,
    borderColor: '#36BF8D',
    borderRadius: 8,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  overlayBottom: {
    flex: 1.8,
    backgroundColor: 'rgba(20, 25, 38, 0.6)',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#36BF8D',
  },
  topLeftCorner: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRightCorner: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeftCorner: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRightCorner: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  overlayGuideText: {
    color: '#36BF8D',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    backgroundColor: 'rgba(20, 25, 38, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  manualSearchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20, 25, 38, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  manualSearchCard: {
    backgroundColor: '#F2F2F2',
    padding: 20,
    borderRadius: 12,
    width: '100%',
    borderWidth: 1,
    borderColor: '#CCC',
    elevation: 5,
  },
  manualSearchTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#141926',
    textAlign: 'center',
    marginBottom: 5,
  },
  manualSearchSubtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  manualSearchInput: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CCC',
    borderRadius: 8,
    padding: 12,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#141926',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 3,
  },
});
