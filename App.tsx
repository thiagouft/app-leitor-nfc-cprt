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
  const [sentidoVeiculo, setSentidoVeiculo] = useState<"ENTRADA" | "SAIDA">("ENTRADA");

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

  useEffect(() => {
    async function setup() {
      try {
        await initDB();
        setIsDbReady(true);
        const savedUrl = await getApiUrl();
        setUrl(savedUrl);
        const pStr = await SecureStore.getItemAsync("selected_portaria");
        if (pStr) {
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
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        const { sound: successSound } = await ExpoAudio.Sound.createAsync(
          require("./assets/sounds/allowed.wav"),
        );
        const { sound: errorSound } = await ExpoAudio.Sound.createAsync(
          require("./assets/sounds/blocked.wav"),
        );

        await successSound.setVolumeAsync(1.0);
        await errorSound.setVolumeAsync(1.0);

        soundRefs.current.success = successSound;
        soundRefs.current.error = errorSound;
      } catch (e) {
        console.warn("Audio load erro:", e);
      }
    }

    initNfc();
    initAudio();

    return () => {
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
      soundRefs.current.success?.unloadAsync();
      soundRefs.current.error?.unloadAsync();
    };
  }, []);

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
    const sound = allowed ? soundRefs.current.success : soundRefs.current.error;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (
        typeof status === "object" &&
        "isPlaying" in status &&
        status.isPlaying
      ) {
        await sound.stopAsync();
      }
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch (e) {
      console.warn("Sound play error:", e);
    }
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
      const photo = await cameraRef.current.takePictureAsync({ base64: false });
      const result = await TextRecognition.recognize(photo.uri);
      
      const regexPlaca = /[a-zA-Z]{3}[0-9][A-Za-z0-9][0-9]{2}/g;
      
      const allText = result.blocks.map(b => b.text).join(" ").replace(/[^a-zA-Z0-9]/g, "");
      
      let placaEncontrada = "";
      const matches = allText.match(/[a-zA-Z]{3}[0-9][A-Za-z0-9][0-9]{2}/g);
      
      if (matches && matches.length > 0) {
        placaEncontrada = matches[0].toUpperCase();
      } else if (allText.length >= 7) {
        placaEncontrada = allText.substring(0, 7).toUpperCase();
      }

      if (!placaEncontrada) {
        Alert.alert("Erro", "Nenhuma placa identificada na imagem. Tente novamente.");
        setLoading(false);
        return;
      }

      const veiculo = await findVeiculoByPlaca(placaEncontrada);
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
            situacaoCode
          );

          playFeedbackSound(situacaoCode === 1);
          await refreshPendingLeituras();

          Alert.alert(
            situacaoCode === 1 ? "Acesso Permitido" : "Acesso Bloqueado",
            `Veículo: ${veiculo.placa}\nCondutor: ${nome}`,
            [
              { text: "OK", onPress: () => {
                setPlacaLida(null);
                setAguardandoNfcCondutor(false);
                NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
              }}
            ]
          );
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
    setCurrentScreen("DASHBOARD");
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
              {aguardandoNfcCondutor ? `Placa Lida: ${placaLida?.placa}. Aproxime o cartão do condutor.` : "Centralize a placa e capture a imagem."}
            </Text>
          </View>

          <View style={{ flex: 1, backgroundColor: "#000", overflow: "hidden" }}>
            {!aguardandoNfcCondutor ? (
              <CameraView 
                style={{ flex: 1 }} 
                facing="back" 
                ref={cameraRef}
              >
                <View style={{ flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end', padding: 20 }}>
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
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: "#3269D9", marginBottom: 15 }]}
                    onPress={capturarPlaca}
                    disabled={loading}
                  >
                    {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Capturar Placa</Text>}
                  </TouchableOpacity>
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
                    Aproxime o cartão do condutor no sensor NFC do celular.
                  </Text>
                  <ActivityIndicator size="large" color="#3269D9" style={{marginTop: 15}} />
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
});
