'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { kml, gpx } from '@tmcw/togeojson';
import { supabase } from '../lib/supabase';

// ベースマップのスタイル定義（コンポーネントの外に定義）
const BASEMAP_STYLE = {
  version: 8 as const,
  sources: {
    'gsi-pale': { type: 'raster' as const, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256, attribution: '国土地理院' },
    'gsi-std': { type: 'raster' as const, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'], tileSize: 256, attribution: '国土地理院' },
    'gsi-photo': { type: 'raster' as const, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'], tileSize: 256, attribution: '国土地理院' },
    'osm': { type: 'raster' as const, tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' }
  },
  layers: [
    { id: 'basemap-gsi-photo', type: 'raster' as const, source: 'gsi-photo', layout: { visibility: 'none' as const } },
    { id: 'basemap-osm', type: 'raster' as const, source: 'osm', layout: { visibility: 'none' as const } },
    { id: 'basemap-gsi-std', type: 'raster' as const, source: 'gsi-std', layout: { visibility: 'none' as const } },
    { id: 'basemap-gsi-pale', type: 'raster' as const, source: 'gsi-pale', layout: { visibility: 'visible' as const } }
  ]
};

const AVAILABLE_TAGS = ['合宿記録', '巡検記録', 'ジオい(ネタ帳)', '個人おでかけ', 'その他'];

const parseDescription = (desc: any) => {
  if (!desc) return '';
  if (typeof desc === 'string') {
    try {
      const parsed = JSON.parse(desc);
      if (parsed && parsed.value) return parsed.value;
    } catch (e) {
      return desc;
    }
  }
  return desc;
};

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  // 既存のカラー・スタイル設定用ステート
  const [lineColor, setLineColor] = useState('#22c55e');
  const [lineWidth, setLineWidth] = useState(4);
  const [lineStyle, setLineStyle] = useState('solid');
  const [pointColor, setPointColor] = useState('#eab308');

  // アップロード・保存用ステート
  const [uploadData, setUploadData] = useState<any>(null);
  const [routeTitle, setRouteTitle] = useState('');
  const [routeDesc, setRouteDesc] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>(''); 
  const [uploading, setUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 認証関連ステート
  const [session, setSession] = useState<any>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [checkingMember, setCheckingMember] = useState(false);
  const [userProfile, setUserProfile] = useState<{ name: string; avatar: string } | null>(null);

  // 現在選択されているベースマップを管理するステート
  const [currentBasemap, setCurrentBasemap] = useState('gsi-pale');
  
  // 3Dモードのステート
  const [is3DMode, setIs3DMode] = useState(false);

  const sessionRef = useRef<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      sessionRef.current = session;
      if (session) {
        checkDiscordMembership(session);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      sessionRef.current = session;
      if (session) {
        checkDiscordMembership(session);
      } else {
        setIsMember(null);
        setUserProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkDiscordMembership = async (currentSession: any) => {
    if (!currentSession?.provider_token) {
      setIsMember(false);
      return;
    }
    setCheckingMember(true);
    try {
      // ユーザープロファイル取得
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${currentSession.provider_token}` }
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        setUserProfile({
          name: userData.global_name || userData.username,
          avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'
        });
      }

      // ギルド所属チェック
      const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${currentSession.provider_token}` }
      });
      if (guildsRes.ok) {
        const guilds = await guildsRes.json();
        const targetGuildId = process.env.NEXT_PUBLIC_DISCORD_GUILD_ID;
        const hasGuild = guilds.some((g: any) => g.id === targetGuildId);
        setIsMember(hasGuild);
      } else {
        setIsMember(false);
      }
    } catch (error) {
      console.error(error);
      setIsMember(false);
    } finally {
      setCheckingMember(false);
    }
  };

  // ベースマップ切り替え関数
  const changeBasemap = (basemapId: string) => {
    if (!map.current) return;
    const targetLayers = ['basemap-gsi-pale', 'basemap-gsi-std', 'basemap-gsi-photo', 'basemap-osm'];
    
    targetLayers.forEach((id) => {
      const visibility = id === `basemap-${basemapId}` ? 'visible' : 'none';
      if (map.current?.getLayer(id)) {
        map.current.setLayoutProperty(id, 'visibility', visibility);
      }
    });
    setCurrentBasemap(basemapId);
  };

  // 3Dモード切り替え関数
  const toggle3DMode = () => {
    if (!map.current) return;
    
    if (!is3DMode) {
      if (!map.current.getSource('gsidem-terrain-rgb')) {
        map.current.addSource('gsidem-terrain-rgb', {
          type: 'raster-dem',
          tiles: [
            'https://gsj-seamless.jp/seamless/elev/php/terrainRGB.php?url=https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a> / <a href="https://gsj-seamless.jp/seamless/elev/terrainRGB.html" target="_blank">産総研</a>'
        });
      }
      map.current.setTerrain({ source: 'gsidem-terrain-rgb', exaggeration: 1.5 });
      map.current.easeTo({ pitch: 65, duration: 1000 });
    } else {
      map.current.setTerrain(null);
      map.current.easeTo({ pitch: 0, duration: 1000 });
    }
    
    setIs3DMode(!is3DMode);
  };

  useEffect(() => {
    if (map.current) return;

    // 初期スタイルを定義したオブジェクトに置き換え
    map.current = new maplibregl.Map({
      container: mapContainer.current!,
      style: BASEMAP_STYLE,
      center: [139.6917, 35.6895],
      zoom: 9
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
      }),
      'top-right'
    );

    //縮尺コントロールを右下に追加
    map.current.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 100,
        unit: 'metric'
      }),
      'bottom-right'
    );

    map.current.on('load', async () => {
      if (!map.current) return;

      // 既存のデータベースからのデータ読み込み処理
      const { data: routes, error } = await supabase.from('routes').select('*');
      if (error) {
        console.error(error);
        return;
      }

      routes.forEach((route: any) => {
        const sourceId = `route-${route.id}`;
        map.current!.addSource(sourceId, {
          type: 'geojson',
          data: route.geojson
        });

        if (route.geojson.type === 'FeatureCollection' || route.geojson.type === 'Feature') {
          const hasLine = route.geojson.features 
            ? route.geojson.features.some((f: any) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
            : (route.geojson.geometry.type === 'LineString' || route.geojson.geometry.type === 'MultiLineString');
          
          const hasPoint = route.geojson.features
            ? route.geojson.features.some((f: any) => f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint')
            : (route.geojson.geometry.type === 'Point' || route.geojson.geometry.type === 'MultiPoint');

          if (hasLine) {
            map.current!.addLayer({
              id: `${sourceId}-line`,
              type: 'line',
              source: sourceId,
              layout: {
                'line-join': 'round',
                'line-cap': 'round'
              },
              paint: {
                'line-color': route.line_color || '#22c55e',
                'line-width': route.line_width || 4,
                'line-dasharray': route.line_style === 'dashed' ? [2, 2] : [1, 0]
              },
              filter: ['in', '$type', 'LineString', 'Polygon']
            });
          }

          if (hasPoint) {
            map.current!.addLayer({
              id: `${sourceId}-point`,
              type: 'circle',
              source: sourceId,
              paint: {
                'circle-radius': 6,
                'circle-color': route.point_color || '#eab308',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
              },
              filter: ['==', '$type', 'Point']
            });
          }
        }
      });
    });

    // クリック時のポップアップ制御（ログアウト時作成者非表示対応版）
    map.current.on('click', async (e) => {
      if (!map.current) return;
      const features = map.current.queryRenderedFeatures(e.point);
      const routeFeature = features.find(f => f.layer.id.startsWith('route-') && f.layer.id.endsWith('-line'));
      const pointFeature = features.find(f => f.layer.id.startsWith('route-') && f.layer.id.endsWith('-point'));
      const targetFeature = routeFeature || pointFeature;

      if (targetFeature) {
        const sourceId = targetFeature.layer.source;
        const routeId = sourceId.replace('route-', '');

        const { data: route, error } = await supabase.from('routes').select('*').eq('id', routeId).single();
        if (error || !route) return;

        const props = targetFeature.properties || {};
        const popupContainer = document.createElement('div');
        popupContainer.style.fontFamily = 'sans-serif';
        popupContainer.style.padding = '5px';
        popupContainer.style.maxWidth = '240px';

        const titleEl = document.createElement('h3');
        titleEl.style.margin = '0 0 5px 0';
        titleEl.style.fontSize = '14px';
        titleEl.style.fontWeight = 'bold';
        titleEl.innerText = route.title || props.name || '名称未設定のルート';
        popupContainer.appendChild(titleEl);

        if (route.category) {
          const tagSpan = document.createElement('span');
          tagSpan.style.display = 'inline-block';
          tagSpan.style.backgroundColor = '#e2e8f0';
          tagSpan.style.color = '#4a5568';
          tagSpan.style.fontSize = '10px';
          tagSpan.style.padding = '2px 6px';
          tagSpan.style.borderRadius = '4px';
          tagSpan.style.marginBottom = '8px';
          tagSpan.innerText = route.category;
          popupContainer.appendChild(tagSpan);
        }

        //ログイン状態の時のみ作成者情報を表示するロジックを維持
        if (sessionRef.current && route.creator_name) {
          const creatorDiv = document.createElement('div');
          creatorDiv.style.display = 'flex';
          creatorDiv.style.alignItems = 'center';
          creatorDiv.style.gap = '6px';
          creatorDiv.style.marginBottom = '8px';
          creatorDiv.style.padding = '4px';
          creatorDiv.style.backgroundColor = '#f8fafc';
          creatorDiv.style.borderRadius = '4px';

          if (route.creator_avatar) {
            const img = document.createElement('img');
            img.src = route.creator_avatar;
            img.style.width = '18px';
            img.style.height = '18px';
            img.style.borderRadius = '50%';
            creatorDiv.appendChild(img);
          }

          const nameSpan = document.createElement('span');
          nameSpan.style.fontSize = '11px';
          nameSpan.style.color = '#64748b';
          nameSpan.innerText = route.creator_name;
          creatorDiv.appendChild(nameSpan);
          popupContainer.appendChild(creatorDiv);
        }

        const descEl = document.createElement('p');
        descEl.style.margin = '0';
        descEl.style.fontSize = '12px';
        descEl.style.color = '#4b5563';
        descEl.style.lineHeight = '1.4';
        descEl.style.whiteSpace = 'pre-wrap';
        descEl.innerText = route.description || parseDescription(props.description) || '説明はありません。';
        popupContainer.appendChild(descEl);

        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setDOMContent(popupContainer)
          .addTo(map.current);
      }
    });
  }, []);

  // ファイル読み込み処理
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const text = await file.text();
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    
    let geojson: any = null;
    if (file.name.endsWith('.kml')) {
      geojson = kml(dom);
    } else if (file.name.endsWith('.gpx')) {
      geojson = gpx(dom);
    } else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
      geojson = JSON.parse(text);
    }

    setUploading(false);

    if (geojson) {
      setUploadData(geojson);
      setRouteTitle(file.name.replace(/\.[^/.]+$/, ""));

      if (map.current) {
        if (map.current.getSource('preview-source')) {
          map.current.removeLayer('preview-layer-line');
          map.current.removeLayer('preview-layer-point');
          map.current.removeSource('preview-source');
        }

        map.current.addSource('preview-source', {
          type: 'geojson',
          data: geojson
        });

        map.current.addLayer({
          id: 'preview-layer-line',
          type: 'line',
          source: 'preview-source',
          paint: {
            'line-color': lineColor,
            'line-width': lineWidth,
            'line-dasharray': lineStyle === 'dashed' ? [2, 2] : [1, 0]
          },
          filter: ['in', '$type', 'LineString', 'Polygon']
        });

        map.current.addLayer({
          id: 'preview-layer-point',
          type: 'circle',
          source: 'preview-source',
          paint: {
            'circle-radius': 6,
            'circle-color': pointColor,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          },
          filter: ['==', '$type', 'Point']
        });

        // プレビュー全体が入るようにカメラ位置を設定
        const coordinates: [number, number][] = [];
        const extractCoords = (geometry: any) => {
          if (geometry.type === 'Point') coordinates.push(geometry.coordinates);
          else if (geometry.type === 'LineString') coordinates.push(...geometry.coordinates);
          else if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring: any) => coordinates.push(...ring));
          else if (geometry.type === 'MultiLineString' || geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((part: any) => {
              if (geometry.type === 'MultiLineString') coordinates.push(...part);
              else part.forEach((ring: any) => coordinates.push(...ring));
            });
          }
        };

        if (geojson.type === 'FeatureCollection') {
          geojson.features.forEach((f: any) => extractCoords(f.geometry));
        } else if (geojson.type === 'Feature') {
          extractCoords(geojson.geometry);
        } else {
          extractCoords(geojson);
        }

        if (coordinates.length > 0) {
          const bounds = coordinates.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
          map.current.fitBounds(bounds, { padding: 50 });
        }
      }
    }
  };

  // プレビューのリアルタイムスタイル更新
  useEffect(() => {
    if (map.current && map.current.getLayer('preview-layer-line')) {
      map.current.setPaintProperty('preview-layer-line', 'line-color', lineColor);
      map.current.setPaintProperty('preview-layer-line', 'line-width', lineWidth);
      map.current.setPaintProperty('preview-layer-line', 'line-dasharray', lineStyle === 'dashed' ? [2, 2] : [1, 0]);
    }
  }, [lineColor, lineWidth, lineStyle]);

  useEffect(() => {
    if (map.current && map.current.getLayer('preview-layer-point')) {
      map.current.setPaintProperty('preview-layer-point', 'circle-color', pointColor);
    }
  }, [pointColor]);

  // データベース保存処理
  const handleSaveToDatabase = async () => {
    if (!uploadData) return;
    setIsSaving(true);

    try {
      const { data, error } = await supabase.from('routes').insert([{
        title: routeTitle,
        description: routeDesc,
        geojson: uploadData,
        line_color: lineColor,
        line_width: lineWidth,
        line_style: lineStyle,
        point_color: pointColor,
        category: selectedTag,
        creator_name: userProfile?.name || null,
        creator_avatar: userProfile?.avatar || null
      }]).select();

      if (error) throw error;

      alert('データベースに保存しました！');

      if (map.current && data && data[0]) {
        const newRoute = data[0];
        const sourceId = `route-${newRoute.id}`;

        if (map.current.getSource('preview-source')) {
          map.current.removeLayer('preview-layer-line');
          map.current.removeLayer('preview-layer-point');
          map.current.removeSource('preview-source');
        }

        map.current.addSource(sourceId, { type: 'geojson', data: newRoute.geojson });
        
        map.current.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': newRoute.line_color,
            'line-width': newRoute.line_width,
            'line-dasharray': newRoute.line_style === 'dashed' ? [2, 2] : [1, 0]
          },
          filter: ['in', '$type', 'LineString', 'Polygon']
        });

        map.current.addLayer({
          id: `${sourceId}-point`,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 6,
            'circle-color': newRoute.point_color,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          },
          filter: ['==', '$type', 'Point']
        });
      }

      setUploadData(null);
      setRouteTitle('');
      setRouteDesc('');
      setSelectedTag('');
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* 地図コンテナ */}
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* サイドバーUI */}
      <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, width: '320px', backgroundColor: 'rgba(255,255,255,0.95)', padding: '15px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>駒澤大学地理学研究会<br/><span style={{ fontSize: '12px', color: '#666' }}>空間情報データ倉庫(仮)</span></h2>
          {session && (
            <button onClick={handleLogout} style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>ログアウト</button>
          )}
        </div>

        {!session ? (
          <button onClick={handleLogin} style={{ width: '100%', padding: '10px', backgroundColor: '#5865F2', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Discordでログイン</button>
        ) : checkingMember ? (
          <p style={{ fontSize: '13px', color: '#666' }}>サークル会員情報を確認中...</p>
        ) : isMember === false ? (
          <div style={{ padding: '10px', backgroundColor: '#fee2e2', color: '#ef4444', borderRadius: '4px', fontSize: '13px' }}>
            認証エラー: 指定のDiscordサーバーに参加していないか、権限がありません。
          </div>
        ) : isMember === true ? (
          <div>
            {userProfile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px', padding: '8px', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
                <img src={userProfile.avatar} alt="avatar" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>{userProfile.name}</span>
              </div>
            )}

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>▶ 新規アップロード</h3>
              <input type="file" accept=".kml,.gpx,.geojson,.json" onChange={handleFileChange} disabled={uploading} style={{ fontSize: '12px', width: '100%', marginBottom: '10px' }} />
              {uploading && <p style={{ fontSize: '12px', color: '#666' }}>ファイルを解析中...</p>}
            </div>

            {uploadData && (
              <div style={{ marginTop: '15px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                <input type="text" value={routeTitle} onChange={e => setRouteTitle(e.target.value)} placeholder="ルートタイトル" style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '8px', border: '1px solid #cbd5e1', borderRadius: '4px' }} />
                <textarea value={routeDesc} onChange={e => setRouteDesc(e.target.value)} placeholder="ルートの説明やメモ" style={{ width: '100%', padding: '6px', fontSize: '13px', height: '60px', marginBottom: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', resize: 'none' }} />
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px', fontSize: '12px', backgroundColor: '#f8fafc', padding: '8px', borderRadius: '4px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>線の色:</span><input type="color" value={lineColor} onChange={e => setLineColor(e.target.value)} /></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>太さ ({lineWidth}px):</span><input type="range" min="1" max="10" value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} /></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>種類:</span><select value={lineStyle} onChange={e => setLineStyle(e.target.value)}><option value="solid">実線</option><option value="dashed">破線</option></select></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>ピンの色:</span><input type="color" value={pointColor} onChange={e => setPointColor(e.target.value)} /></label>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {AVAILABLE_TAGS.map(tag => (
                    <label key={tag} style={{ fontSize: '11px' }}><input type="radio" name="routeCategory" value={tag} checked={selectedTag === tag} onChange={() => setSelectedTag(tag)} />{tag}</label>
                  ))}
                </div>
                <button onClick={handleSaveToDatabase} disabled={isSaving || !uploadData} style={{ width: '100%', padding: '10px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>保存</button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 3D切り替え & ベースマップUI（右下、縮尺コントロールの上に絶対配置） */}
      <div 
        style={{ 
          position: 'absolute', 
          bottom: '50px', 
          right: '10px', 
          zIndex: 10, 
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'flex-end'
        }}
      >
        <button 
          onClick={toggle3DMode}
          style={{
            padding: '8px 12px',
            backgroundColor: is3DMode ? '#3b82f6' : 'white',
            color: is3DMode ? 'white' : '#334155',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            transition: 'all 0.2s ease'
          }}
        >
          {is3DMode ? '🏔️ 3D表示: オン' : '⛰️ 3D表示: オフ'}
        </button>

        <div style={{ backgroundColor: 'white', padding: '6px 10px', borderRadius: '4px', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', border: '1px solid #ccc' }}>
          <select 
            value={currentBasemap} 
            onChange={(e) => changeBasemap(e.target.value)}
            style={{ 
              fontSize: '12px', 
              border: 'none', 
              outline: 'none', 
              cursor: 'pointer', 
              fontWeight: 'bold', 
              color: '#333',
              backgroundColor: 'transparent'
            }}
          >
            <option value="gsi-pale">🗺️ 地理院 淡色</option>
            <option value="gsi-std">🗺️ 地理院 標準</option>
            <option value="gsi-photo">📷 地理院 衛星写真</option>
            <option value="osm">🌍 OpenStreetMap</option>
          </select>
        </div>
      </div>
    </div>
  );
}