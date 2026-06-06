'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { kml } from '@tmcw/togeojson';
import { supabase } from '../lib/supabase';

export default function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [lineColor, setLineColor] = useState('#22c55e');
  const [lineWidth, setLineWidth] = useState(4);
  const [lineStyle, setLineStyle] = useState('solid');
  const [pointColor, setPointColor] = useState('#eab308');

  const [uploadData, setUploadData] = useState<any>(null);
  const [routeTitle, setRouteTitle] = useState('');
  const [routeDesc, setRouteDesc] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');

  const [session, setSession] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchSavedRoutes = async () => {
    try {
      const { data, error } = await supabase.from('routes').select('*');
      if (error) throw error;

      const features = data.map((row: any) => ({
        type: 'Feature',
        geometry: row.geom,
        properties: {
          id: row.id,
          name: row.title,
          description: row.description,
          color: row.line_color || '#3b82f6',
          width: row.line_width || 4,
          style: row.line_style || 'solid',
          pointColor: row.point_color || '#eab308' 
        }
      }));

      const source = map.current?.getSource('saved-data') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({ type: 'FeatureCollection', features } as any);
      }
    } catch (err) {
      console.error('データの取得エラー:', err);
    }
  };

  const fetchComments = async (routeId: string) => {
    try {
      const { data, error } = await supabase.from('comments').select('*').eq('route_id', routeId).order('created_at', { ascending: true });
      if (error) throw error;
      setComments(data || []);
    } catch (err) {
      console.error('コメント取得エラー:', err);
    }
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          gsi_pale: {
            type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256,
            attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>"
          }
        },
        layers: [{ id: 'gsi_pale_layer', type: 'raster', source: 'gsi_pale', minzoom: 2, maxzoom: 18 }]
      },
      center: [139.5445, 35.6533],
      zoom: 13
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      map.current?.addSource('saved-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      
      map.current?.addLayer({
        id: 'saved-lines-solid', type: 'line', source: 'saved-data',
        filter: ['all', ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], ['==', 'style', 'solid']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8 }
      });
      
      map.current?.addLayer({
        id: 'saved-lines-dashed', type: 'line', source: 'saved-data',
        filter: ['all', ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], ['==', 'style', 'dashed']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8, 'line-dasharray': [2, 2] }
      });

      map.current?.addLayer({
        id: 'saved-points', type: 'circle', source: 'saved-data',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 8, 'circle-color': ['get', 'pointColor'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
      });

      map.current?.addSource('preview-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      
      map.current?.addLayer({
        id: 'preview-lines', type: 'line', source: 'preview-data', filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': lineColor, 'line-width': lineWidth, 'line-opacity': 0.8 }
      });

      map.current?.addLayer({
        id: 'preview-points', type: 'circle', source: 'preview-data', filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 8, 'circle-color': pointColor, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
      });

      fetchSavedRoutes();

      const interactiveLayers = ['saved-lines-solid', 'saved-lines-dashed', 'saved-points'];
      
      interactiveLayers.forEach(layerId => {
        map.current?.on('click', layerId, (e) => {
          if (!e.features || e.features.length === 0) return;
          const feature = e.features[0];
          const props = feature.properties;
          setSelectedRoute({ id: props.id, name: props.name, description: props.description });
          fetchComments(props.id);
        });
        map.current?.on('mouseenter', layerId, () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
        map.current?.on('mouseleave', layerId, () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
      });
    });
  }, []);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    try {
      map.current.setPaintProperty('preview-lines', 'line-color', lineColor);
      map.current.setPaintProperty('preview-lines', 'line-width', lineWidth);
      map.current.setPaintProperty('preview-lines', 'line-dasharray', lineStyle === 'dashed' ? [2, 2] : [1, 0]);
      map.current.setPaintProperty('preview-points', 'circle-color', pointColor);
    } catch (e) {}
  }, [lineColor, lineWidth, lineStyle, pointColor]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { setSelectedFileName(null); return; }
    setSelectedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      try {
        let geojson: any;
        if (file.name.endsWith('.kml')) geojson = kml(new DOMParser().parseFromString(result, 'text/xml'));
        else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) geojson = JSON.parse(result);
        else return alert('対応していないファイル形式です。');
        
        const source = map.current?.getSource('preview-data') as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(geojson);
          if (geojson.features && geojson.features.length > 0) {
            const firstFeature = geojson.features[0];
            setUploadData(firstFeature);
            setRouteTitle(firstFeature.properties?.name || firstFeature.properties?.T1_Name || '');
            setRouteDesc(firstFeature.properties?.description || firstFeature.properties?.T2_Memo || '');

            const geomType = firstFeature.geometry.type;
            const coords = firstFeature.geometry.coordinates;
            let targetLng, targetLat;
            if (geomType === 'Point') { [targetLng, targetLat] = coords; } 
            else if (geomType === 'LineString' || geomType === 'MultiPoint') { [targetLng, targetLat] = coords[0]; } 
            else if (geomType === 'Polygon' || geomType === 'MultiLineString') { [targetLng, targetLat] = coords[0][0]; } 
            else if (geomType === 'MultiPolygon') { [targetLng, targetLat] = coords[0][0][0]; }
            if (targetLng !== undefined && targetLat !== undefined) map.current?.flyTo({ center: [targetLng, targetLat], zoom: 14 });
          }
        }
      } catch (err) {
        alert('ファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  const force2D = (coords: any): any => {
    if (typeof coords[0] === 'number') return [coords[0], coords[1]];
    return coords.map(force2D);
  };

  const handleSaveToDatabase = async () => {
    if (!uploadData || !routeTitle.trim()) return;
    setIsSaving(true);
    try {
      const cleanGeometry = { ...uploadData.geometry, coordinates: force2D(uploadData.geometry.coordinates) };
      
      const { error } = await supabase.from('routes').insert({ 
        title: routeTitle, 
        description: routeDesc, 
        geom: cleanGeometry,
        line_color: lineColor,
        line_width: lineWidth,
        line_style: lineStyle,
        point_color: pointColor
      });
      if (error) throw error;
      
      alert('データベースへの保存に成功しました！');
      
      const previewSource = map.current?.getSource('preview-data') as maplibregl.GeoJSONSource;
      if (previewSource) previewSource.setData({ type: 'FeatureCollection', features: [] });
      
      setUploadData(null);
      setRouteTitle('');
      setRouteDesc('');
      setSelectedFileName(null);
      fetchSavedRoutes();
    } catch (err: any) {
      alert('保存に失敗しました: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveComment = async () => {
    if (!newComment.trim() || !selectedRoute) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('comments').insert({ route_id: selectedRoute.id, content: newComment });
      if (error) throw error;
      setNewComment('');
      fetchComments(selectedRoute.id);
    } catch (err: any) {
      alert('コメントの保存に失敗しました: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // 【追加】Discordでのログイン処理
  const handleDiscordLogin = async () => {
    setIsAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
    });
    if (error) {
      alert('ログインエラー: ' + error.message);
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div style={{
        position: 'absolute', top: '10px', left: '10px', zIndex: 1, backgroundColor: 'white', padding: '15px',
        borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', color: 'black', width: '320px',
        maxHeight: 'calc(100vh - 20px)', display: 'flex', flexDirection: 'column'
      }}>
        
        {/* 未ログインの場合はDiscordログイン画面を表示 */}
        {!session ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <h3 style={{ margin: '0', fontSize: '15px', fontWeight: 'bold' }}>ログインが必要です</h3>
            <p style={{ margin: '0', fontSize: '12px', color: '#475569' }}>
              地理研のDiscordアカウントを使用してログインしてください。
            </p>
            <button 
              onClick={handleDiscordLogin} disabled={isAuthLoading} 
              style={{
                width: '100%', padding: '10px', fontSize: '14px', fontWeight: 'bold',
                backgroundColor: '#5865F2', color: 'white', border: 'none', borderRadius: '4px',
                cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center'
              }}
            >
              Discordでログイン
            </button>
          </div>
        ) : selectedRoute ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
              <button onClick={() => setSelectedRoute(null)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold', padding: 0 }}>
                ← 一覧・登録へ戻る
              </button>
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer', padding: 0 }}>ログアウト</button>
            </div>
            <h3 style={{ margin: '0 0 5px 0', fontSize: '16px', fontWeight: 'bold' }}>{selectedRoute.name}</h3>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '15px', whiteSpace: 'pre-wrap' }}>{selectedRoute.description}</p>
            <hr style={{ margin: '0 0 15px 0', border: 'none', borderTop: '1px solid #ddd' }} />
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>コメント</h4>
            <div style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '15px', paddingRight: '5px' }}>
              {comments.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#94a3b8' }}>まだコメントはありません。</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {comments.map((c) => (
                    <li key={c.id} style={{ backgroundColor: '#f1f5f9', padding: '10px', borderRadius: '6px', fontSize: '13px' }}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '5px', textAlign: 'right' }}>{new Date(c.created_at).toLocaleString('ja-JP')}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
              <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="コメントを入力..." style={{ padding: '8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', resize: 'vertical', minHeight: '60px' }} />
              <button onClick={handleSaveComment} disabled={isSaving || !newComment.trim()} style={{ padding: '8px', fontSize: '13px', fontWeight: 'bold', borderRadius: '4px', border: 'none', backgroundColor: (isSaving || !newComment.trim()) ? '#ccc' : '#3b82f6', color: 'white', cursor: (isSaving || !newComment.trim()) ? 'not-allowed' : 'pointer' }}>
                {isSaving ? '送信中...' : '送信する'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', paddingRight: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>空間データ読み込み＆保存</h3>
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer', padding: 0 }}>ログアウト</button>
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', padding: '12px', backgroundColor: '#f8fafc', border: '2px dashed #cbd5e1', borderRadius: '6px', textAlign: 'center', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: '#475569', transition: 'background-color 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}>
                {selectedFileName ? `📂 ${selectedFileName}` : '📂 ファイルを選択 (KML / GeoJSON)'}
                <input type="file" accept=".geojson,.json,.kml" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' }} />
            <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 'bold' }}>タイトル:</label>
              <input type="text" value={routeTitle} onChange={(e) => setRouteTitle(e.target.value)} placeholder="例：〇〇巡検ルート" style={{ padding: '4px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }} />
              <label style={{ fontSize: '13px', fontWeight: 'bold' }}>説明・メモ:</label>
              <textarea value={routeDesc} onChange={(e) => setRouteDesc(e.target.value)} placeholder="ルートに関する詳細なメモ" style={{ padding: '4px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', minHeight: '60px', resize: 'vertical' }} />
              <button onClick={handleSaveToDatabase} disabled={isSaving || !uploadData} style={{ marginTop: '5px', padding: '8px', fontSize: '13px', fontWeight: 'bold', backgroundColor: (isSaving || !uploadData) ? '#ccc' : '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: (isSaving || !uploadData) ? 'not-allowed' : 'pointer' }}>
                {isSaving ? '保存中...' : 'データベースに保存'}
              </button>
            </div>
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>線の色:</span><input type="color" value={lineColor} onChange={e => setLineColor(e.target.value)} /></label>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>太さ ({lineWidth}px):</span><input type="range" min="1" max="10" value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} /></label>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>種類:</span><select value={lineStyle} onChange={e => setLineStyle(e.target.value)}><option value="solid">実線</option><option value="dashed">破線</option></select></label>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>ピンの色:</span><input type="color" value={pointColor} onChange={e => setPointColor(e.target.value)} /></label>
            </div>
          </div>
        )}
      </div>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}