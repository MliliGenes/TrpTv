#!/usr/bin/env node

import axios from 'axios';
import * as cheerio from 'cheerio';

async function testEmbedExtraction() {
    const testUrl = 'https://gomovies-sx.net/embed/tv/606/1/1';
    
    try {
        console.log('🔍 Fetching embed page:', testUrl);
        
        const response = await axios.get(testUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://gomovies-sx.net/'
            },
            timeout: 15000
        });
        
        console.log('✅ Page loaded, status:', response.status);
        console.log('📄 Content length:', response.data.length);
        
        const $ = cheerio.load(response.data);
        
        // Check what scripts are on the page
        console.log('\n🔍 Analyzing page content...');
        console.log('Scripts found:', $('script').length);
        console.log('Iframes found:', $('iframe').length);
        console.log('Video elements found:', $('video').length);
        
        // Look at script contents
        console.log('\n📜 Script contents:');
        $('script').each((i, script) => {
            const content = $(script).html();
            if (content && content.length > 50) {
                console.log(`Script ${i + 1} (${content.length} chars):`, content.substring(0, 200) + '...');
                
                // Look for video-related patterns
                if (content.includes('.mp4') || content.includes('.m3u8') || content.includes('video') || content.includes('player')) {
                    console.log(`🎯 Found video-related content in script ${i + 1}`);
                }
            }
        });
        
        // Check for iframes
        console.log('\n🖼️  Iframe sources:');
        $('iframe').each((i, iframe) => {
            const src = $(iframe).attr('src');
            if (src) {
                console.log(`Iframe ${i + 1}:`, src);
            }
        });
        
        // Look for any URLs in the page
        console.log('\n🔗 Looking for URLs in page content...');
        const pageText = $.html();
        const urlMatches = pageText.match(/https?:\/\/[^\s'"<>]+/g);
        if (urlMatches) {
            const videoUrls = urlMatches.filter(url => 
                url.includes('.mp4') || 
                url.includes('.m3u8') || 
                url.includes('player') || 
                url.includes('stream')
            );
            
            if (videoUrls.length > 0) {
                console.log('🎬 Found potential video URLs:');
                videoUrls.forEach(url => console.log('  -', url));
            } else {
                console.log('❌ No obvious video URLs found');
                console.log('📋 Sample URLs found:', urlMatches.slice(0, 5));
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testEmbedExtraction();