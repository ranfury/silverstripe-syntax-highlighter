<?php

namespace SilverStripe\Assets;

use SilverStripe\ORM\DataObject;
use SilverStripe\Assets\Storage\AssetContainer;

interface AssetContainerInterface
{
}

trait ImageManipulation
{
    /**
     * @return AssetContainer
     */
    public function Fill($width, $height) {}

    /**
     * @return AssetContainer|Image
     */
    public function ScaleWidth($width) {}
}

class File extends DataObject implements AssetContainerInterface
{
    use ImageManipulation;

    private static $db = [
        'Name' => 'Varchar(255)',
        'Title' => 'Varchar(255)',
    ];

    public function getURL($grant = true) {}
}

class Image extends File
{
}
