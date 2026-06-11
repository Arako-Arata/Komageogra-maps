'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { kml } from '@tmcw/togeojson';
import { supabase } from '../lib/supabase';

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

  const [lineColor, setLineColor] = useState('#22c55e');
  const [lineWidth, setLineWidth] = useState(4);
  const [lineStyle, setLineStyle] = useState('solid');
  const [pointColor, setPointColor] = useState('#eab308');

  const [uploadData, setUploadData] = useState<any>(null);
  const [routeTitle, setRouteTitle] = useState('');
  const [routeDesc, setRouteDesc] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>(''); 
  const [uploadImage, setUploadImage] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const AVAILABLE_TAGS = ['合宿記録', '巡検記録', 'ジオい(ネタ帳)', '個人おでかけ', 'その他'];
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false); 

  const [savedFeatures, setSavedFeatures] = useState<any[]>([]); 
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([]); 
  const [session, setSession] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true); 
  
  const [isEditingRoute, setIsEditingRoute] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTag, setEditTag] = useState<string>('');
  const [editImage, setEditImage] = useState<File | null>(null);
  const [isDeletingImage, setIsDeletingImage] = useState(false);

  const [editLineColor, setEditLineColor] = useState('#3b82f6');
  const [editLineWidth, setEditLineWidth] = useState(4);
  const [editLineStyle, setEditLineStyle] = useState('solid');
  const [editPointColor, setEditPointColor] = useState('#eab308');
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 

  const sessionRef = useRef<any>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const [profile, setProfile] = useState<any>(null);

  const checkAndUpsertProfile = async (user: any) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      
      if (error && error.code === 'PGRST116') {
        const newProfile = {
          id: user.id,
          display_name: user.user_metadata?.full_name || user.user_metadata?.name || 'ゲスト',
          avatar_url: user.user_metadata?.avatar_url || '',
          department: ''
        };
        await supabase.from('profiles').insert(newProfile);
        setProfile(newProfile);
      } else if (data) {
        setProfile(data);
      }
    } catch (err) {
      console.error('プロフィールの取得・作成エラー:', err);
    }
  };

  useEffect(() => {
    if (window.innerWidth >= 768) {
      setIsSidebarOpen(true);
    }
  }, []);

  const ALLOWED_GUILD_ID = '1049983719445889034';

  useEffect(() => {
    const isRedirecting = typeof window !== 'undefined' && window.location.hash.includes('access_token');
    if (!isRedirecting) setIsVerifying(false);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isRedirecting) {
        setSession(session);
        if (session?.user) checkAndUpsertProfile(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') {
        if (session?.provider_token) {
          setIsVerifying(true);
          try {
            const res = await fetch('https://discord.com/api/users/@me/guilds', {
              headers: { Authorization: `Bearer ${session.provider_token}` }
            });

            if (res.ok) {
              const guilds = await res.json();
              const isMember = guilds.some((g: any) => g.id === ALLOWED_GUILD_ID);

              if (!isMember) {
                alert('エラー: 地理学研究会のDiscordサーバーに参加しているメンバーのみ利用可能です。');
                await supabase.auth.signOut();
                setSession(null);
                setIsVerifying(false);
                return;
              }
            } else {
              alert('サーバー情報が取得できませんでした。権限を許可してください。');
              await supabase.auth.signOut();
              setSession(null);
              setIsVerifying(false);
              return;
            }
          } catch (err) {
            console.error('サーバー参加確認に失敗しました:', err);
            await supabase.auth.signOut();
            setSession(null);
            setIsVerifying(false);
            return;
          }
        }
        
        setSession(session);
        if (session?.user) checkAndUpsertProfile(session.user);
        setIsVerifying(false);
        
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsVerifying(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdateRoute = async () => {
    if (!selectedRoute || !editTitle.trim()) return;
    setIsSaving(true);
    try {
      const { data: currentData, error: fetchError } = await supabase.from('routes').select('features_data, title, description').eq('id', selectedRoute.id).single();
      if (fetchError) throw fetchError;

      let newTitle = currentData.title;
      let newDesc = currentData.description;
      let newFeaturesData = currentData.features_data;
      let finalImageUrl = selectedRoute.properties.image_url;

      if (isDeletingImage) {
        finalImageUrl = null;
      } else if (editImage) {
        const fileExt = editImage.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('images').upload(fileName, editImage);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('images').getPublicUrl(fileName);
        finalImageUrl = urlData.publicUrl;
      }

      if (newFeaturesData && Array.isArray(newFeaturesData)) {
        newFeaturesData = newFeaturesData.map((f: any, idx: number) => {
          const fid = f.properties?._feature_id || `legacy_${idx}`;
          if (fid === selectedRoute.properties._feature_id) {
             return { ...f, properties: { ...f.properties, name: editTitle, description: editDesc, image_url: finalImageUrl } };
          }
          return f;
        });
      }

      if (newFeaturesData && newFeaturesData.length === 1) {
        newTitle = editTitle;
      }

      const newTags = editTag ? [editTag] : [];
      
      const { data: updatedRows, error: updateError } = await supabase.from('routes')
        .update({ 
          title: newTitle, description: newDesc, features_data: newFeaturesData, tags: newTags,
          line_color: editLineColor, line_width: editLineWidth, line_style: editLineStyle, point_color: editPointColor
        })
        .eq('id', selectedRoute.id).select();
        
      if (updateError) throw updateError;
      if (!updatedRows || updatedRows.length === 0) throw new Error('更新権限がありません。');

      alert('更新しました');
      setIsEditingRoute(false); setEditImage(null); setIsDeletingImage(false);
      await fetchSavedRoutes(); 
      setSelectedRoute((prev: any) => ({ 
        ...prev, name: editTitle, description: editDesc, 
        properties: { ...prev.properties, tags: newTags, image_url: finalImageUrl, color: editLineColor, width: editLineWidth, style: editLineStyle, pointColor: editPointColor } 
      }));
    } catch (err: any) { alert('更新に失敗しました: ' + err.message); } finally { setIsSaving(false); }
  };

  const fetchSavedRoutes = async () => {
    try {
      const { data, error } = await supabase.from('routes').select('*');
      if (error) throw error;

      const features: any[] = [];
      data.forEach((row: any) => {
        const baseProperties = {
          id: row.id, name: row.title, description: row.description, color: row.line_color || '#3b82f6', width: row.line_width || 4,
          style: row.line_style || 'solid', pointColor: row.point_color || '#eab308', userId: row.user_id, tags: row.tags || []
        };

        if (row.features_data && Array.isArray(row.features_data) && row.features_data.length > 0) {
          row.features_data.forEach((f: any, idx: number) => {
            const individualName = f.properties?.name || f.properties?.T1_Name || baseProperties.name;
            const individualDesc = f.properties?.description || baseProperties.description;
            const fid = f.properties?._feature_id || `legacy_${idx}`; 
            
            features.push({
              type: 'Feature', geometry: f.geometry,
              properties: { ...baseProperties, name: individualName, description: individualDesc, originalParentName: baseProperties.name, image_url: f.properties?.image_url, _feature_id: fid }
            });
          });
        } else {
          features.push({ type: 'Feature', geometry: row.geom, properties: { ...baseProperties, originalParentName: baseProperties.name } });
        }
      });
      setSavedFeatures(features);
    } catch (err) {}
  };

  useEffect(() => {
    const source = map.current?.getSource('saved-data') as maplibregl.GeoJSONSource;
    if (source) {
      const visibleFeatures = savedFeatures.filter(f => {
        if (hiddenRouteIds.includes(f.properties.id)) return false;
        if (!session) {
          const tags = f.properties.tags || [];
          return tags.includes('合宿記録') || tags.includes('巡検記録');
        }
        return true;
      });
      source.setData({ type: 'FeatureCollection', features: visibleFeatures } as any);
    }
  }, [savedFeatures, hiddenRouteIds, session]);

  const fetchComments = async (routeId: string) => {
    try {
      const { data, error } = await supabase.from('comments').select('*, profiles(display_name, avatar_url)').eq('route_id', routeId).order('created_at', { ascending: true });
      if (error) throw error;
      setComments(data || []);
    } catch (err) {}
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const style = document.createElement('style');
    style.innerHTML = `
      .maplibregl-popup-close-button { font-size: 24px !important; padding: 4px 12px !important; color: #64748b !important; width: 40px; height: 40px; outline: none; }
      .maplibregl-popup-close-button:hover { background-color: #f1f5f9 !important; color: #ef4444 !important; border-radius: 0 4px 0 0; }
      .custom-popup-content a { color: #3b82f6; text-decoration: underline; }
    `;
    document.head.appendChild(style);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { gsi_pale: { type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256, attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>" } },
        layers: [{ id: 'gsi_pale_layer', type: 'raster', source: 'gsi_pale', minzoom: 2, maxzoom: 18 }]
      },
      center: [139.658630, 35.628857], zoom: 9
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
      }),
      'top-right'
    );

    map.current.on('load', () => {
      map.current?.addSource('saved-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.current?.addLayer({ id: 'saved-lines-solid', type: 'line', source: 'saved-data', filter: ['all', ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], ['!=', 'style', 'dashed']], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8 } });
      map.current?.addLayer({ id: 'saved-lines-dashed', type: 'line', source: 'saved-data', filter: ['all', ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], ['==', 'style', 'dashed']], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.8, 'line-dasharray': [2, 2] } });
      map.current?.addLayer({ id: 'saved-points', type: 'circle', source: 'saved-data', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': ['get', 'pointColor'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });

      map.current?.addLayer({ id: 'flash-lines', type: 'line', source: 'saved-data', filter: ['==', 'name', ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
      map.current?.addLayer({ id: 'flash-points', type: 'circle', source: 'saved-data', filter: ['==', 'name', ''], paint: { 'circle-radius': 14, 'circle-color': '#ffffff', 'circle-opacity': 0.9 } });

      map.current?.addSource('preview-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current?.addLayer({ id: 'preview-lines', type: 'line', source: 'preview-data', filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], paint: { 'line-color': lineColor, 'line-width': lineWidth, 'line-opacity': 0.8, 'line-dasharray': lineStyle === 'dashed' ? [2, 2] : [1, 0] } });
      map.current?.addLayer({ id: 'preview-points', type: 'circle', source: 'preview-data', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': pointColor, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });

      fetchSavedRoutes();

      const interactiveLayers = ['saved-lines-solid', 'saved-lines-dashed', 'saved-points'];

      interactiveLayers.forEach(layerId => {
        map.current?.on('click', layerId, (e) => {
          if (!e.features || e.features.length === 0 || !map.current) return;
          const feature = e.features[0];
          const props = feature.properties;
          const targetFilter = ['all', ['==', 'id', props.id], ['==', 'name', props.name || '']] as any;

          if (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') {
            map.current?.setFilter('flash-points', targetFilter);
            setTimeout(() => { if (map.current) map.current.setFilter('flash-points', ['==', 'name', ''] as any); }, 300);
          } else {
            map.current?.setFilter('flash-lines', targetFilter);
            setTimeout(() => { if (map.current) map.current.setFilter('flash-lines', ['==', 'name', ''] as any); }, 300);
          }

          let coordinates: [number, number] = feature.geometry.type === 'Point' ? [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] : [e.lngLat.lng, e.lngLat.lat];
          let parsedTags = [];
          if (typeof props.tags === 'string') { try { parsedTags = JSON.parse(props.tags); } catch (err) {} } else if (Array.isArray(props.tags)) { parsedTags = props.tags; }

          const popupDiv = document.createElement('div');
          popupDiv.className = 'custom-popup-content';
          popupDiv.style.padding = '4px'; popupDiv.style.color = '#334155'; popupDiv.style.fontFamily = 'sans-serif';
          const title = document.createElement('h4');
          title.style.margin = '0 0 4px 0'; title.style.fontSize = '14px'; title.style.fontWeight = 'bold'; title.innerText = props.name || '名称未設定';
          popupDiv.appendChild(title);

          if (props.originalParentName && props.originalParentName !== props.name) {
            const parentName = document.createElement('div');
            parentName.style.fontSize = '11px'; parentName.style.color = '#64748b'; parentName.style.marginBottom = '6px'; parentName.innerText = `📁 ${props.originalParentName}`;
            popupDiv.appendChild(parentName);
          }

          if (props.image_url) {
            const img = document.createElement('img');
            img.src = props.image_url; img.style.width = '100%'; img.style.maxHeight = '150px'; img.style.objectFit = 'cover'; img.style.borderRadius = '4px'; img.style.marginBottom = '8px';
            popupDiv.appendChild(img);
          }

          if (props.description) {
            const desc = document.createElement('div');
            desc.style.fontSize = '12px'; desc.style.color = '#475569'; desc.style.marginBottom = '8px'; desc.style.lineHeight = '1.4';
            desc.style.wordBreak = 'break-word';
            desc.innerHTML = parseDescription(props.description);
            popupDiv.appendChild(desc);
          }

          if (parsedTags.length > 0) {
            const tagsDiv = document.createElement('div');
            tagsDiv.style.display = 'flex'; tagsDiv.style.gap = '4px'; tagsDiv.style.marginBottom = '8px'; tagsDiv.style.flexWrap = 'wrap';
            parsedTags.forEach((tag: string) => {
              const span = document.createElement('span');
              span.innerText = `#${tag}`; span.style.backgroundColor = '#e2e8f0'; span.style.color = '#334155'; span.style.padding = '2px 8px'; span.style.borderRadius = '12px'; span.style.fontSize = '11px'; span.style.fontWeight = 'bold';
              tagsDiv.appendChild(span);
            });
            popupDiv.appendChild(tagsDiv);
          }

          if (sessionRef.current) {
            const btn = document.createElement('button');
            // 【修正】作成者のみに「編集」の文字を含める
            const isOwner = sessionRef.current.user?.id === props.userId;
            btn.innerText = isOwner ? '詳細・コメント・編集' : '詳細・コメント';
            
            btn.style.width = '100%'; btn.style.padding = '8px'; btn.style.marginTop = '4px'; btn.style.backgroundColor = '#3b82f6'; btn.style.color = 'white'; btn.style.border = 'none'; btn.style.borderRadius = '4px'; btn.style.cursor = 'pointer'; btn.style.fontSize = '12px'; btn.style.fontWeight = 'bold';
            btn.onclick = async () => {
              try {
                const { data, error } = await supabase.from('routes').select('geom').eq('id', props.id).single();
                if (error) throw error;
                setSelectedRoute({ id: props.id, name: props.name, description: props.description, geometry: data.geom, properties: { ...props, tags: parsedTags } });
                fetchComments(props.id);
                setIsSidebarOpen(true);
              } catch (err) { alert('ルートデータの取得に失敗しました。'); }
            };
            popupDiv.appendChild(btn);
          }

          const existingPopups = document.getElementsByClassName('maplibregl-popup');
          for (let i = 0; i < existingPopups.length; i++) { existingPopups[i].remove(); }
          new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' }).setLngLat(coordinates).setDOMContent(popupDiv).addTo(map.current!);
        });
        map.current?.on('mouseenter', layerId, () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
        map.current?.on('mouseleave', layerId, () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
      });
    });
  }, []);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    try {
      map.current.setPaintProperty('preview-lines', 'line-color', lineColor); map.current.setPaintProperty('preview-lines', 'line-width', lineWidth); map.current.setPaintProperty('preview-lines', 'line-dasharray', lineStyle === 'dashed' ? [2, 2] : [1, 0]); map.current.setPaintProperty('preview-points', 'circle-color', pointColor);
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
        const source = map.current?.getSource('preview-data') as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(geojson);
          if (geojson.features && geojson.features.length > 0) {
            let lineCoords: any[] = []; let pointCoords: any[] = []; let featureName = ''; let featureDesc = '';
            geojson.features.forEach((f: any) => {
              if (!featureName && (f.properties?.name || f.properties?.T1_Name)) featureName = f.properties?.name || f.properties?.T1_Name;
              if (!featureDesc && (f.properties?.description || f.properties?.T2_Memo)) {
                const desc = f.properties?.description || f.properties?.T2_Memo;
                featureDesc = typeof desc === 'object' ? JSON.stringify(desc) : desc;
              }
              if (f.geometry.type === 'LineString') lineCoords.push(f.geometry.coordinates);
              else if (f.geometry.type === 'MultiLineString') lineCoords.push(...f.geometry.coordinates);
              else if (f.geometry.type === 'Point') pointCoords.push(f.geometry.coordinates);
              else if (f.geometry.type === 'MultiPoint') pointCoords.push(...f.geometry.coordinates);
            });
            
            let finalGeom: any = geojson.features[0]?.geometry || null;
            if (lineCoords.length > 0) {
              finalGeom = lineCoords.length === 1 ? { type: 'LineString', coordinates: lineCoords[0] } : { type: 'MultiLineString', coordinates: lineCoords };
            } else if (pointCoords.length > 0) {
              finalGeom = pointCoords.length === 1 ? { type: 'Point', coordinates: pointCoords[0] } : { type: 'MultiPoint', coordinates: pointCoords };
            }
            
            if (!finalGeom) return;

            const combinedFeature = { type: 'Feature', geometry: finalGeom, properties: geojson.features[0].properties, originalFeatures: geojson.features };
            setUploadData(combinedFeature);
            if (pointCoords.length > 1 && file.name) setRouteTitle(file.name.replace(/\.[^/.]+$/, ""));
            else setRouteTitle(featureName || '');
            setRouteDesc(featureDesc || '');

            let targetLng, targetLat;
            if (finalGeom.type === 'Point') [targetLng, targetLat] = finalGeom.coordinates;
            else if (finalGeom.type === 'MultiPoint') [targetLng, targetLat] = finalGeom.coordinates[0];
            else if (finalGeom.type === 'LineString') [targetLng, targetLat] = finalGeom.coordinates[0];
            else if (finalGeom.type === 'MultiLineString') [targetLng, targetLat] = finalGeom.coordinates[0][0];
            if (targetLng !== undefined && targetLat !== undefined) map.current?.flyTo({ center: [targetLng, targetLat], zoom: 8 }); 
          }
        }
      } catch (err) {}
    };
    reader.readAsText(file);
  };

  const force2D = (coords: any): any => { if (typeof coords[0] === 'number') return [coords[0], coords[1]]; return coords.map(force2D); };

  const handleSaveToDatabase = async () => {
    if (!uploadData || !routeTitle.trim()) return;
    setIsSaving(true);
    try {
      let imageUrl = null;
      if (uploadImage) {
        const fileExt = uploadImage.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('images').upload(fileName, uploadImage);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('images').getPublicUrl(fileName);
        imageUrl = urlData.publicUrl;
      }
      
      const featuresDataWithImage = uploadData.originalFeatures.map((f: any, idx: number) => ({ 
        ...f, properties: { ...f.properties, image_url: imageUrl || f.properties.image_url, _feature_id: `${Date.now()}_${idx}` } 
      }));
      
      const cleanGeometry = { ...uploadData.geometry, coordinates: force2D(uploadData.geometry.coordinates) };
      const { error } = await supabase.from('routes').insert({ 
        title: routeTitle, description: routeDesc, geom: cleanGeometry, line_color: lineColor, line_width: lineWidth, line_style: lineStyle, point_color: pointColor,
        user_id: session?.user?.id, tags: selectedTag ? [selectedTag] : [],
        features_data: featuresDataWithImage
      });
      if (error) throw error;
      alert('データベースへの保存に成功しました！');
      const previewSource = map.current?.getSource('preview-data') as maplibregl.GeoJSONSource;
      if (previewSource) previewSource.setData({ type: 'FeatureCollection', features: [] });
      setUploadData(null); setRouteTitle(''); setRouteDesc(''); setSelectedTag(''); setSelectedFileName(null); setUploadImage(null);
      fetchSavedRoutes();
    } catch (err: any) { alert('保存に失敗しました: ' + err.message); } finally { setIsSaving(false); }
  };

  const handleSaveComment = async () => {
    if (!newComment.trim() || !selectedRoute) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('comments').insert({ route_id: selectedRoute.id, content: newComment, user_id: session?.user?.id });
      if (error) throw error;
      setNewComment(''); fetchComments(selectedRoute.id);
    } catch (err: any) { alert('コメントの保存に失敗しました: ' + err.message); } finally { setIsSaving(false); }
  };

  const handleDeleteRoute = async () => {
    if (!selectedRoute) return;
    if (!window.confirm('このルートと関連するコメントをすべて削除します。本当によろしいですか？')) return;
    setIsSaving(true);
    try {
      await supabase.from('comments').delete().eq('route_id', selectedRoute.id);
      await supabase.from('routes').delete().eq('id', selectedRoute.id);
      alert('データを削除しました。');
      setSelectedRoute(null); fetchSavedRoutes();
    } catch (err: any) { alert('削除に失敗しました: ' + err.message); } finally { setIsSaving(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm('このコメントを削除しますか？')) return;
    setIsSaving(true);
    try {
      await supabase.from('comments').delete().eq('id', commentId);
      if (selectedRoute) fetchComments(selectedRoute.id);
    } catch (err: any) { alert('コメントの削除に失敗しました: ' + err.message); } finally { setIsSaving(false); }
  };

  const handleDownloadGeoJSON = () => {
    if (!selectedRoute) return;
    const geojsonFeature = { type: 'Feature', geometry: selectedRoute.geometry, properties: { title: selectedRoute.name, description: selectedRoute.description, line_color: selectedRoute.properties.color, line_width: selectedRoute.properties.width, line_style: selectedRoute.properties.style, point_color: selectedRoute.properties.pointColor } };
    const blob = new Blob([JSON.stringify(geojsonFeature, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${selectedRoute.name || 'route'}.geojson`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleDiscordLogin = async () => {
    setIsAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { queryParams: { prompt: 'consent', scope: 'identify email guilds' } } });
    if (error) { alert('ログインエラー: ' + error.message); setIsAuthLoading(false); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const getBounds = (geometry: any) => {
    let coords: any[] = [];
    if (geometry.type === 'Point') coords = [geometry.coordinates];
    else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') coords = geometry.coordinates;
    else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') coords = geometry.coordinates.flat(1);
    else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates.flat(2);
    if (coords.length === 0) return null;
    const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (const coord of coords) { bounds.extend(coord); }
    return bounds;
  };

  const handleRouteClick = (route: any) => {
    if (!map.current) return;
    const bounds = getBounds(route.geometry);
    if (bounds) {
      if (route.geometry.type === 'Point') { map.current.flyTo({ center: route.geometry.coordinates, zoom: 15, duration: 2000 }); } 
      else {
        const padding = window.innerWidth >= 768 ? { top: 50, bottom: 50, left: 350, right: 50 } : { top: 70, bottom: 50, left: 20, right: 20 };
        map.current.fitBounds(bounds, { padding, maxZoom: 14, duration: 2000 });
      }
    }
    const targetFilter = ['all', ['==', 'id', route.properties.id], ['==', 'name', route.properties.name || '']] as any;
    if (route.geometry.type === 'Point' || route.geometry.type === 'MultiPoint') { map.current.setFilter('flash-points', targetFilter); setTimeout(() => { if (map.current) map.current.setFilter('flash-points', ['==', 'name', ''] as any); }, 600); } 
    else { map.current.setFilter('flash-lines', targetFilter); setTimeout(() => { if (map.current) map.current.setFilter('flash-lines', ['==', 'name', ''] as any); }, 600); }
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 20, width: '40px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: 'pointer', fontSize: '20px', color: '#334155' }}>{isSidebarOpen ? '✕' : '☰'}</button>
      {!session && !isVerifying && (
        <button onClick={handleDiscordLogin} style={{ position: 'absolute', top: '10px', left: '60px', zIndex: 20, padding: '0 12px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', color: '#ef4444' }}>ログイン</button>
      )}

      <div style={{ position: 'absolute', top: '0', left: '0', zIndex: 10, backgroundColor: 'rgba(255, 255, 255, 0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', padding: '15px', paddingTop: '60px', boxShadow: '2px 0 8px rgba(0,0,0,0.2)', color: 'black', width: '100%', maxWidth: '320px', height: '100%', display: 'flex', flexDirection: 'column', transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s ease-in-out' }}>
        
        {selectedRoute ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: '12px', borderRadius: '8px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
              <button onClick={() => { setSelectedRoute(null); setIsEditingRoute(false); setEditImage(null); setIsDeletingImage(false); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold', padding: 0 }}>← 一覧・登録へ戻る</button>
            </div>

            {isEditingRoute ? (
              <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold' }}>タイトル:</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="タイトル" style={{ padding: '6px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }} />
                
                <label style={{ fontSize: '13px', fontWeight: 'bold' }}>説明:</label>
                <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="説明・メモ" style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', minHeight: '80px' }} />
                
                <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>📷 画像の管理:</label>
                  {selectedRoute.properties.image_url && !isDeletingImage && (
                    <div style={{ marginBottom: '8px' }}>
                      <img src={selectedRoute.properties.image_url} alt="現在" style={{ width: '100%', maxHeight: '80px', objectFit: 'cover', borderRadius: '4px' }} />
                      <button onClick={() => setIsDeletingImage(true)} style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>🗑️ 現在の画像を削除する</button>
                    </div>
                  )}
                  {isDeletingImage && <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '8px' }}>※保存時に画像が削除されます</div>}
                  
                  <label style={{ display: 'block', padding: '8px', textAlign: 'center', cursor: 'pointer', border: '1px solid #334155', borderRadius: '4px', backgroundColor: '#ffffff', fontSize: '12px', color: '#334155' }}>
                    {editImage ? `📷 ${editImage.name}` : 'ファイルを選択'}
                    <input type="file" accept="image/*" onChange={(e) => { setEditImage(e.target.files?.[0] || null); setIsDeletingImage(false); }} style={{ display: 'none' }} />
                  </label>
                </div>

                <div style={{ marginTop: '4px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>🎨 スタイル設定:</label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>線の色:</span><input type="color" value={editLineColor} onChange={e => setEditLineColor(e.target.value)} /></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>太さ ({editLineWidth}px):</span><input type="range" min="1" max="10" value={editLineWidth} onChange={e => setEditLineWidth(Number(e.target.value))} /></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>種類:</span><select value={editLineStyle} onChange={e => setEditLineStyle(e.target.value)}><option value="solid">実線</option><option value="dashed">破線</option></select></label>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}><span>ピンの色:</span><input type="color" value={editPointColor} onChange={e => setEditPointColor(e.target.value)} /></label>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {AVAILABLE_TAGS.map(tag => (
                    <label key={tag} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><input type="radio" name="editRouteCategory" value={tag} checked={editTag === tag} onChange={() => setEditTag(tag)} />{tag}</label>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleUpdateRoute} disabled={isSaving || !editTitle.trim()} style={{ flex: 1, padding: '8px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>{isSaving ? '保存中...' : '💾 保存'}</button>
                  <button onClick={() => { setIsEditingRoute(false); setEditImage(null); setIsDeletingImage(false); }} style={{ flex: 1, padding: '8px', backgroundColor: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px' }}>キャンセル</button>
                </div>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 'bold' }}>{selectedRoute.name}</h3>
                {selectedRoute.properties.originalParentName && selectedRoute.properties.originalParentName !== selectedRoute.name && (
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>📁 {selectedRoute.properties.originalParentName}</div>
                )}
                {selectedRoute.properties.image_url && (
                  <img src={selectedRoute.properties.image_url} alt="登録画像" style={{ width: '100%', borderRadius: '6px', marginBottom: '10px' }} />
                )}
                <div 
                  style={{ fontSize: '13px', color: '#475569', marginBottom: '10px', lineHeight: '1.5', wordBreak: 'break-word' }} 
                  dangerouslySetInnerHTML={{ __html: parseDescription(selectedRoute.description) }} 
                />
                
                {selectedRoute.properties.tags && selectedRoute.properties.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '15px' }}>
                    {selectedRoute.properties.tags.map((tag: string) => <span key={tag} style={{ backgroundColor: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>#{tag}</span>)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                  <button onClick={handleDownloadGeoJSON} style={{ flex: 1, padding: '8px', fontSize: '13px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px' }}>📥 GeoJSON DL</button>
                  {session?.user?.id === selectedRoute.properties.userId && (
                    <>
                      <button onClick={() => { 
                        setEditTitle(selectedRoute.name); 
                        setEditDesc(parseDescription(selectedRoute.description || '')); 
                        setEditTag(selectedRoute.properties.tags?.[0] || ''); 
                        setEditLineColor(selectedRoute.properties.color || '#3b82f6');
                        setEditLineWidth(selectedRoute.properties.width || 4);
                        setEditLineStyle(selectedRoute.properties.style || 'solid');
                        setEditPointColor(selectedRoute.properties.pointColor || '#eab308');
                        setIsEditingRoute(true); 
                      }} style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '4px' }}>✏️ 編集</button>
                      <button onClick={handleDeleteRoute} disabled={isSaving} style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px' }}>🗑️</button>
                    </>
                  )}
                </div>
              </>
            )}

            {!isEditingRoute && (
              <>
                <hr style={{ margin: '0 0 15px 0', borderTop: '1px solid #ddd' }} />
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>コメント</h4>
                <div style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '15px' }}>
                  {comments.length === 0 ? <p style={{ fontSize: '12px', color: '#94a3b8' }}>まだコメントはありません。</p> : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {comments.map((c) => (
                        <li key={c.id} style={{ backgroundColor: '#f1f5f9', padding: '10px', borderRadius: '6px', fontSize: '13px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {c.profiles?.avatar_url && <img src={c.profiles.avatar_url} alt="avatar" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />}
                              <span style={{ fontWeight: 'bold', fontSize: '12px' }}>{c.profiles?.display_name || 'ゲスト'}</span>
                            </div>
                            {session?.user?.id === c.user_id && <button onClick={() => handleDeleteComment(c.id)} disabled={isSaving} style={{ background: 'none', border: 'none', color: '#ef4444' }}>🗑️</button>}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="コメントを入力..." style={{ padding: '8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px', minHeight: '60px' }} />
                  <button onClick={handleSaveComment} disabled={isSaving || !newComment.trim()} style={{ padding: '8px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px' }}>送信</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: '10px 12px', borderRadius: '8px' }}>
              <img src="/logo.png" style={{ height: '30px', objectFit: 'contain', maxWidth: 'calc(100% - 60px)' }} />
              {session && <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', fontWeight: 'bold' }}>ログアウト</button>}
            </div>

            {session && (
              <>
                <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {profile?.avatar_url && <img src={profile.avatar_url} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />}
                  <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{profile?.display_name}</span>
                </div>
                <button onClick={() => setShowUploadForm(!showUploadForm)} style={{ width: '100%', padding: '8px', marginBottom: '15px', backgroundColor: showUploadForm ? '#e2e8f0' : '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', fontWeight: 'bold' }}>{showUploadForm ? '▼ 閉じる' : '▶ 新規アップロード'}</button>
              </>
            )}

            {!showUploadForm && (
              <div style={{ padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.85)', borderRadius: '8px', marginBottom: '15px' }}>
                {AVAILABLE_TAGS.map(tag => {
                  if (!session && tag !== '合宿記録' && tag !== '巡検記録') return null;
                  const routesInTag = savedFeatures.filter(f => {
                    const tagList = f.properties.tags || [];
                    if (tag === 'その他') return tagList.includes('その他') || tagList.length === 0 || !AVAILABLE_TAGS.some(t => tagList.includes(t));
                    return tagList.includes(tag);
                  });
                  if (routesInTag.length === 0) return null;
                  const isAllHidden = routesInTag.every(f => hiddenRouteIds.includes(f.properties.id));
                  return (
                    <div key={tag} style={{ marginBottom: '12px' }}>
                      <label style={{ fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input type="checkbox" checked={!isAllHidden} onChange={() => { if (isAllHidden) { setHiddenRouteIds(prev => prev.filter(id => !routesInTag.find(f => f.properties.id === id))); } else { setHiddenRouteIds(prev => Array.from(new Set([...prev, ...routesInTag.map(f => f.properties.id)]))); } }} />📁 {tag}
                      </label>
                      <div style={{ marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        {routesInTag.filter((route, index, self) => index === self.findIndex((r) => r.properties.id === route.properties.id)).map(route => (
                          <div key={route.properties.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                            <input type="checkbox" checked={!hiddenRouteIds.includes(route.properties.id)} onChange={(e) => { if (e.target.checked) { setHiddenRouteIds(prev => prev.filter(id => id !== route.properties.id)); } else { setHiddenRouteIds(prev => [...prev, route.properties.id]); } }} />
                            <div onClick={() => handleRouteClick(route)} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: route.properties.color }} />
                              <span onMouseEnter={(e) => e.currentTarget.style.color = '#3b82f6'} onMouseLeave={(e) => e.currentTarget.style.color = ''}>{route.properties.originalParentName || route.properties.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {session && showUploadForm && (
              <div style={{ padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: '8px' }}>
                
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>🗺️ KML, GeoJSONを添付:</label>
                  <label style={{ display: 'block', padding: '8px', textAlign: 'center', cursor: 'pointer', border: '1px solid #334155', borderRadius: '4px', backgroundColor: '#f8fafc', fontSize: '13px', color: '#334155' }}>
                    {selectedFileName ? `📁 ${selectedFileName}` : 'ファイルを選択'}
                    <input type="file" accept=".geojson,.json,.kml" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>

                <input type="text" value={routeTitle} onChange={(e) => setRouteTitle(e.target.value)} placeholder="タイトル" style={{ width: '100%', padding: '6px', marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <textarea value={routeDesc} onChange={(e) => setRouteDesc(e.target.value)} placeholder="メモ" style={{ width: '100%', padding: '6px', marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
                
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>📷 画像を添付 (任意):</label>
                  <label style={{ display: 'block', padding: '8px', textAlign: 'center', cursor: 'pointer', border: '1px solid #334155', borderRadius: '4px', backgroundColor: '#f8fafc', fontSize: '13px', color: '#334155' }}>
                    {uploadImage ? `📷 ${uploadImage.name}` : 'ファイルを選択'}
                    <input type="file" accept="image/*" onChange={(e) => setUploadImage(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                  </label>
                </div>

                <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>🎨 スタイル設定:</label>
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
                <button onClick={handleSaveToDatabase} disabled={isSaving || !uploadData} style={{ width: '100%', padding: '10px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>保存</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}