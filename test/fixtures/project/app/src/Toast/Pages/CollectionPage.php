<?php

namespace Toast\Pages;

use SilverStripe\Model\ArrayData;
use SilverStripe\Model\List\ArrayList;
use SilverStripe\Taxonomy\TaxonomyTerm;
use SilverStripe\Taxonomy\TaxonomyType;

class CollectionPage extends \Page
{
    private static $db = [
        'Intro' => 'HTMLText',
    ];

    private static $many_many = [
        'Categories' => TaxonomyType::class,
    ];
}

class CollectionPageController extends \PageController
{
    public function getCategoriesFilters()
    {
        $list = new ArrayList();
        if ($categories = $this->Categories()) {
            $categories = $categories->sort('Sort');
            foreach ($categories as $category) {
                if ($children = TaxonomyTerm::get()->filter('TypeID', $category->ID)) {
                    if (!$list->find('TypeID', $category->ID)) {
                        $list->push(new ArrayData([
                            'CategoryID' => $category->ID,
                            'CategoryName' => $category->Name,
                            'LabelName' => strtolower($category->Name),
                            'Items' => $children
                        ]));
                    }
                }
            }
        }
        return $list;
    }

    public function getAPIURL()
    {
        return $this->Link('get_category');
    }
}
